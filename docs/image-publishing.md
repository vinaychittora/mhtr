# Web image publishing standard

Public images must be processed before they are referenced by a page. The image processor creates responsive AVIF, WebP and JPEG derivatives, a 1200 x 630 social-preview image when the source is large enough, and a publishing manifest. It removes camera, device, thumbnail and GPS metadata from every derivative.

Run:

```sh
npm run images:web -- \
  --input "/absolute/path/to/source.jpg" \
  --output "src/assets/assets/imgs/field-reports/report-slug" \
  --name "descriptive-image-name" \
  --metadata "/absolute/path/to/image-metadata.json"
```

The metadata JSON must contain:

```json
{
  "title": "Descriptive editorial title",
  "alt": "Objective description of information visible in the image",
  "credit": "Photographer or rights holder",
  "license": "Explicit licence or written-permission status",
  "source": "Original file or public source URL",
  "capturedAt": "2026-08-13",
  "sensitiveLocationReviewed": true,
  "focalPoint": "attention"
}
```

`sensitiveLocationReviewed` must be true. The review must confirm that the published image, caption and filename do not disclose nests, dens, roosts, live movement, patrol infrastructure or another sensitive wildlife location. The page must use the manifest's credit and licence; processing an image does not create publication rights.

Use AVIF first and WebP/JPEG fallbacks in a `picture` element. Set `srcset`, `sizes`, `width` and `height` from the generated manifest. Use the social JPEG only for page metadata and link previews. Source masters remain outside the public build.
