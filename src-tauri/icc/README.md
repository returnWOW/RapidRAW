`sRGB-v2-magic.icc`, `DisplayP3-v2-magic.icc` and `AdobeRGBCompat-v2.icc` are from
[saucecontrol/Compact-ICC-Profiles](https://github.com/saucecontrol/Compact-ICC-Profiles)
(commit abb1b6f), licensed CC0-1.0 (see `LICENSE-compact-icc-profiles.txt`).

- `sRGB-v2-magic.icc`: sRGB IEC 61966-2-1, 736 bytes.
- `DisplayP3-v2-magic.icc`: Display P3 with the sRGB transfer curve, 736 bytes.
- `AdobeRGBCompat-v2.icc`: Adobe RGB (1998), A98C, 374 bytes.

They are embedded in exported images so color-managed apps and print services
read the correct output color space.
