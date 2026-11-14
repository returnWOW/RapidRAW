use crate::export::settings::{ExportSettings, OutputColorSpace, TiffBitDepth};
use crate::metadata::tiff_metadata::{TiffSamples, encode_tiff_with_metadata};
use crate::metadata::{exif_processing, export_metadata};
use crate::render::color_space::{PRIMARIES_SRGB, WP_D65, primaries_to_xyz_matrix};
use glam::{Mat3, Vec2, Vec3};
use image::codecs::jpeg::{JpegEncoder, PixelDensity};
use image::codecs::png::PngEncoder;
use image::{DynamicImage, GenericImageView, ImageBuffer, ImageEncoder, Rgb, Rgba};
use jxl_encoder::{
    LosslessConfig, LossyConfig, PixelLayout,
    api::{calibrated_jxl_quality, quality_to_distance},
};
use std::borrow::Cow;
#[cfg(not(target_os = "android"))]
use std::fs;
use std::io::Cursor;
use std::path::Path;

pub fn set_timestamps_from_exif(src: &Path, dst: &Path) {
    let capture_dt = exif_processing::get_creation_date_from_path(src);

    if capture_dt.timestamp() <= 0 {
        let now = filetime::FileTime::now();
        if let Err(e) = filetime::set_file_times(dst, now, now) {
            log::warn!("Could not set timestamps on '{}': {}", dst.display(), e);
        }
        return;
    }

    let ft = filetime::FileTime::from_unix_time(
        capture_dt.timestamp(),
        capture_dt.timestamp_subsec_nanos(),
    );
    if let Err(e) = filetime::set_file_times(dst, ft, ft) {
        log::warn!("Could not set timestamps on '{}': {}", dst.display(), e);
    }
}

pub fn save_image_with_metadata(
    image: &DynamicImage,
    output_path: &std::path::Path,
    source_path_str: &str,
    export_xmp: &export_metadata::ExportXmp,
    export_settings: &ExportSettings,
) -> Result<(), String> {
    let extension = output_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let tiff_metadata =
        if export_settings.keep_metadata && matches!(extension.as_str(), "tif" | "tiff") {
            export_metadata::collect_metadata_from_source(
                source_path_str,
                export_settings.strip_gps,
                Some(image.dimensions()),
            )
        } else {
            None
        };

    let mut image_bytes =
        encode_image_to_bytes(image, &extension, export_settings, tiff_metadata.as_ref())?;

    export_metadata::write_image_with_metadata(
        &mut image_bytes,
        source_path_str,
        &extension,
        export_settings.keep_metadata,
        export_settings.strip_gps,
        export_xmp,
        export_settings.dpi,
    )?;

    #[cfg(target_os = "android")]
    {
        let file_name = output_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Missing Android export file name".to_string())?;
        crate::platform::android::save_image_bytes_to_android_gallery(
            file_name,
            mime_type_for_extension(&extension),
            &image_bytes,
        )?;
    }

    #[cfg(not(target_os = "android"))]
    {
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create folder '{}': {}", parent.display(), e))?;
        }
        fs::write(output_path, image_bytes)
            .map_err(|e| format!("Failed to write file to '{}': {}", output_path.display(), e))?;
    }

    Ok(())
}

#[cfg(target_os = "android")]
pub fn mime_type_for_extension(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "tif" | "tiff" => "image/tiff",
        "jxl" => "image/jxl",
        _ => "application/octet-stream",
    }
}

pub(crate) const SRGB_ICC_PROFILE: &[u8] = include_bytes!("../../icc/sRGB-v2-magic.icc");
pub(crate) const DISPLAY_P3_ICC_PROFILE: &[u8] = include_bytes!("../../icc/DisplayP3-v2-magic.icc");
pub(crate) const ADOBE_RGB_ICC_PROFILE: &[u8] = include_bytes!("../../icc/AdobeRGBCompat-v2.icc");

fn output_icc_profile(space: OutputColorSpace) -> &'static [u8] {
    match space {
        OutputColorSpace::Srgb => SRGB_ICC_PROFILE,
        OutputColorSpace::DisplayP3 => DISPLAY_P3_ICC_PROFILE,
        OutputColorSpace::AdobeRgb => ADOBE_RGB_ICC_PROFILE,
    }
}

fn output_primaries(space: OutputColorSpace) -> [Vec2; 3] {
    match space {
        OutputColorSpace::Srgb => PRIMARIES_SRGB,
        OutputColorSpace::DisplayP3 => [
            Vec2::new(0.680, 0.320),
            Vec2::new(0.265, 0.690),
            Vec2::new(0.150, 0.060),
        ],
        OutputColorSpace::AdobeRgb => [
            Vec2::new(0.640, 0.330),
            Vec2::new(0.210, 0.710),
            Vec2::new(0.150, 0.060),
        ],
    }
}

fn srgb_to_linear(value: f32) -> f32 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(value: f32) -> f32 {
    let value = value.clamp(0.0, 1.0);
    if value <= 0.003_130_8 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    }
}

fn linear_to_adobe_rgb(value: f32) -> f32 {
    value.clamp(0.0, 1.0).powf(1.0 / 2.199_218_75)
}

fn encode_output_component(value: f32, space: OutputColorSpace) -> f32 {
    match space {
        OutputColorSpace::Srgb | OutputColorSpace::DisplayP3 => linear_to_srgb(value),
        OutputColorSpace::AdobeRgb => linear_to_adobe_rgb(value),
    }
}

fn convert_srgb_pixel(r: f32, g: f32, b: f32, matrix: Mat3, space: OutputColorSpace) -> (f32, f32, f32) {
    let linear = Vec3::new(srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b));
    let target = matrix * linear;
    (
        encode_output_component(target.x, space),
        encode_output_component(target.y, space),
        encode_output_component(target.z, space),
    )
}

fn output_conversion_matrix(space: OutputColorSpace) -> Mat3 {
    let srgb_to_xyz = primaries_to_xyz_matrix(&PRIMARIES_SRGB, WP_D65);
    let xyz_to_target = primaries_to_xyz_matrix(&output_primaries(space), WP_D65).inverse();
    xyz_to_target * srgb_to_xyz
}

fn to_u8(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn to_u16(value: f32) -> u16 {
    (value.clamp(0.0, 1.0) * 65535.0).round() as u16
}

fn convert_output_color_space(image: &DynamicImage, space: OutputColorSpace) -> DynamicImage {
    if space == OutputColorSpace::Srgb {
        return image.clone();
    }
    let matrix = output_conversion_matrix(space);

    match image {
        DynamicImage::ImageRgb8(buffer) => {
            let mut out: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::new(buffer.width(), buffer.height());
            for (x, y, pixel) in buffer.enumerate_pixels() {
                let (r, g, b) = convert_srgb_pixel(
                    pixel[0] as f32 / 255.0,
                    pixel[1] as f32 / 255.0,
                    pixel[2] as f32 / 255.0,
                    matrix,
                    space,
                );
                out.put_pixel(x, y, Rgb([to_u8(r), to_u8(g), to_u8(b)]));
            }
            DynamicImage::ImageRgb8(out)
        }
        DynamicImage::ImageRgba8(buffer) => {
            let mut out: ImageBuffer<Rgba<u8>, Vec<u8>> =
                ImageBuffer::new(buffer.width(), buffer.height());
            for (x, y, pixel) in buffer.enumerate_pixels() {
                let (r, g, b) = convert_srgb_pixel(
                    pixel[0] as f32 / 255.0,
                    pixel[1] as f32 / 255.0,
                    pixel[2] as f32 / 255.0,
                    matrix,
                    space,
                );
                out.put_pixel(x, y, Rgba([to_u8(r), to_u8(g), to_u8(b), pixel[3]]));
            }
            DynamicImage::ImageRgba8(out)
        }
        DynamicImage::ImageRgb16(buffer) => {
            let mut out: ImageBuffer<Rgb<u16>, Vec<u16>> =
                ImageBuffer::new(buffer.width(), buffer.height());
            for (x, y, pixel) in buffer.enumerate_pixels() {
                let (r, g, b) = convert_srgb_pixel(
                    pixel[0] as f32 / 65535.0,
                    pixel[1] as f32 / 65535.0,
                    pixel[2] as f32 / 65535.0,
                    matrix,
                    space,
                );
                out.put_pixel(x, y, Rgb([to_u16(r), to_u16(g), to_u16(b)]));
            }
            DynamicImage::ImageRgb16(out)
        }
        DynamicImage::ImageRgba16(buffer) => {
            let mut out: ImageBuffer<Rgba<u16>, Vec<u16>> =
                ImageBuffer::new(buffer.width(), buffer.height());
            for (x, y, pixel) in buffer.enumerate_pixels() {
                let (r, g, b) = convert_srgb_pixel(
                    pixel[0] as f32 / 65535.0,
                    pixel[1] as f32 / 65535.0,
                    pixel[2] as f32 / 65535.0,
                    matrix,
                    space,
                );
                out.put_pixel(x, y, Rgba([to_u16(r), to_u16(g), to_u16(b), pixel[3]]));
            }
            DynamicImage::ImageRgba16(out)
        }
        _ => {
            if image.color().has_alpha() {
                convert_output_color_space(&DynamicImage::ImageRgba16(image.to_rgba16()), space)
            } else {
                convert_output_color_space(&DynamicImage::ImageRgb16(image.to_rgb16()), space)
            }
        }
    }
}

pub fn encode_image_to_bytes(
    image: &DynamicImage,
    output_format: &str,
    export_settings: &ExportSettings,
    tiff_metadata: Option<&little_exif::metadata::Metadata>,
) -> Result<Vec<u8>, String> {
    let jpeg_quality = export_settings.jpeg_quality;
    let output_format = output_format.to_lowercase();
    let color_space = export_settings.output_color_space;
    let supports_color_space = matches!(output_format.as_str(), "jpg" | "jpeg" | "png" | "tif" | "tiff");
    if color_space != OutputColorSpace::Srgb && !supports_color_space {
        return Err(
            "Output color space is only supported for JPEG, PNG and TIFF exports.".to_string(),
        );
    }
    let converted_image = if color_space == OutputColorSpace::Srgb {
        None
    } else {
        Some(convert_output_color_space(image, color_space))
    };
    let image = converted_image.as_ref().unwrap_or(image);
    let icc_profile = output_icc_profile(color_space);

    let mut image_bytes = Vec::new();
    let mut cursor = Cursor::new(&mut image_bytes);

    match output_format.as_str() {
        "jxl" => {
            let (width, height) = image.dimensions();
            let has_alpha = image.color().has_alpha();

            let jxl_data = if jpeg_quality == 100 {
                let config = LosslessConfig::new().with_tree_learning(false);
                if has_alpha {
                    let rgba = image.to_rgba8();
                    config
                        .encode(rgba.as_raw(), width, height, PixelLayout::Rgba8)
                        .map_err(|e| format!("Failed to encode lossless JXL: {}", e))?
                } else {
                    let rgb = image.to_rgb8();
                    config
                        .encode(rgb.as_raw(), width, height, PixelLayout::Rgb8)
                        .map_err(|e| format!("Failed to encode lossless JXL: {}", e))?
                }
            } else {
                let jxl_quality = calibrated_jxl_quality(jpeg_quality as f32);
                let distance = quality_to_distance(jxl_quality);

                if has_alpha {
                    let rgba = image.to_rgba8();
                    LossyConfig::new(distance)
                        .encode(rgba.as_raw(), width, height, PixelLayout::Rgba8)
                        .map_err(|e| format!("Failed to encode lossy JXL: {}", e))?
                } else {
                    let rgb = image.to_rgb8();
                    LossyConfig::new(distance)
                        .encode(rgb.as_raw(), width, height, PixelLayout::Rgb8)
                        .map_err(|e| format!("Failed to encode lossy JXL: {}", e))?
                }
            };

            return Ok(jxl_data);
        }
        "webp" => {
            let encoder = webp::Encoder::from_image(image)
                .map_err(|_| "Failed to create WebP encoder".to_string())?;
            let webp_mem = encoder.encode(jpeg_quality as f32);
            return Ok(webp_mem.to_vec());
        }
        "jpg" | "jpeg" => {
            let rgb_image = image
                .as_rgb8()
                .map_or_else(|| Cow::Owned(image.to_rgb8()), Cow::Borrowed);
            let mut encoder = JpegEncoder::new_with_quality(&mut cursor, jpeg_quality);
            encoder
                .set_icc_profile(icc_profile.to_vec())
                .map_err(|e| e.to_string())?;
            if let Some(dpi) = export_settings.dpi {
                encoder.set_pixel_density(PixelDensity::dpi(dpi));
            }
            rgb_image
                .write_with_encoder(encoder)
                .map_err(|e| e.to_string())?;
        }
        "png" => {
            let converted;
            let image_to_encode = if image.as_rgb32f().is_some() {
                converted = DynamicImage::ImageRgb16(image.to_rgb16());
                &converted
            } else {
                image
            };

            let mut encoder = PngEncoder::new(&mut cursor);
            encoder
                .set_icc_profile(icc_profile.to_vec())
                .map_err(|e| e.to_string())?;
            image_to_encode
                .write_with_encoder(encoder)
                .map_err(|e| e.to_string())?;
            if let Some(dpi) = export_settings.dpi {
                insert_png_phys_chunk(&mut image_bytes, dpi);
            }
        }
        "tif" | "tiff" => {
            let samples = match export_settings.tiff_bit_depth {
                TiffBitDepth::Eight => TiffSamples::Eight,
                TiffBitDepth::Sixteen => TiffSamples::Sixteen,
            };
            return encode_tiff_with_metadata(
                image,
                samples,
                tiff_metadata,
                Some(icc_profile),
                export_settings.dpi,
            );
        }
        "avif" => {
            image
                .write_to(&mut cursor, image::ImageFormat::Avif)
                .map_err(|e| e.to_string())?;
        }
        _ => return Err(format!("Unsupported file format: {}", output_format)),
    };
    Ok(image_bytes)
}

fn insert_png_phys_chunk(image_bytes: &mut Vec<u8>, dpi: u16) {
    let pixels_per_meter = (f64::from(dpi) / 0.0254).round() as u32;
    let mut data = Vec::with_capacity(9);
    data.extend_from_slice(&pixels_per_meter.to_be_bytes());
    data.extend_from_slice(&pixels_per_meter.to_be_bytes());
    data.push(1);
    export_metadata::insert_png_chunk(image_bytes, b"pHYs", &data);
}

#[cfg(test)]
mod color_management_tests {
    use super::*;
    use image::{Rgb, RgbImage};

    fn solid(color: [u8; 3]) -> DynamicImage {
        DynamicImage::ImageRgb8(RgbImage::from_pixel(1, 1, Rgb(color)))
    }

    fn pixel(image: &DynamicImage) -> [u8; 3] {
        let rgb = image.to_rgb8();
        rgb.get_pixel(0, 0).0
    }

    #[test]
    fn srgb_is_unchanged() {
        let source = solid([12, 200, 77]);
        let converted = convert_output_color_space(&source, OutputColorSpace::Srgb);
        assert_eq!(pixel(&converted), [12, 200, 77]);
    }

    #[test]
    fn white_and_black_are_preserved() {
        for space in [OutputColorSpace::DisplayP3, OutputColorSpace::AdobeRgb] {
            assert_eq!(pixel(&convert_output_color_space(&solid([255, 255, 255]), space)), [255, 255, 255]);
            assert_eq!(pixel(&convert_output_color_space(&solid([0, 0, 0]), space)), [0, 0, 0]);
        }
    }

    #[test]
    fn p3_red_is_less_saturated_than_srgb_red() {
        let converted = pixel(&convert_output_color_space(
            &solid([255, 0, 0]),
            OutputColorSpace::DisplayP3,
        ));
        assert!(converted[0] < 255, "red channel should fit inside P3: {:?}", converted);
        assert!(converted[1] > 0, "P3 red should need some green: {:?}", converted);
    }

    #[test]
    fn adobe_red_is_less_saturated_than_srgb_red() {
        let converted = pixel(&convert_output_color_space(
            &solid([255, 0, 0]),
            OutputColorSpace::AdobeRgb,
        ));
        assert!(converted[0] < 255, "red channel should fit inside Adobe RGB: {:?}", converted);
    }

    #[test]
    fn embedded_profiles_are_present() {
        assert!(output_icc_profile(OutputColorSpace::Srgb).len() > 100);
        assert!(output_icc_profile(OutputColorSpace::DisplayP3).len() > 100);
        assert!(output_icc_profile(OutputColorSpace::AdobeRgb).len() > 100);
    }
}
