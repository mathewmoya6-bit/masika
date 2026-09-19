#!/usr/bin/env bash
# Masika Benevolent - point every public page at the new logo files.
# Run from the website root (the folder that contains index.html):
#     bash update-logo-references.sh
# A .bak copy of every changed file is kept next to the original.

set -euo pipefail

FILES=$(find . -maxdepth 2 \( -name "*.html" -o -name "*.js" \) \
        -not -path "./node_modules/*" -not -name "*.min.js")

for f in $FILES; do
  cp "$f" "$f.bak"

  perl -0pi -e '
    # 1) favicon + apple-touch-icon <link> tags (keeps ../ prefix if a page is in a subfolder)
    s{<link[^>]*rel="icon"[^>]*?((?:\.\./)*)assets/branding/favicon\.svg[^>]*>}{<link rel="icon" type="image/x-icon" href="$1assets/branding/favicon.ico">\n    <link rel="icon" type="image/png" sizes="32x32" href="$1assets/branding/favicon-32.png">\n    <link rel="icon" type="image/png" sizes="192x192" href="$1assets/branding/favicon-192.png">}g;
    s{(<link[^>]*rel="apple-touch-icon"[^>]*?)((?:\.\./)*)assets/branding/favicon\.svg}{$1$2assets/branding/apple-touch-icon.png}g;

    # 2) social-share image -> 1200x630 card
    s{(og:image"\s+content="[^"]*?)assets/branding/system-logo\.svg}{$1assets/branding/og-image.png}g;
    s{(twitter:image"\s+content="[^"]*?)assets/branding/system-logo\.svg}{$1assets/branding/og-image.png}g;

    # 3) main logo (navbar, headers, schema, emails, receipts...)
    s{assets/branding/system-logo\.svg}{assets/branding/masika-logo.png}g;

    # 4) any remaining small-icon usage
    s{assets/branding/favicon\.svg}{assets/branding/masika-icon.png}g;
  ' "$f"

  if cmp -s "$f" "$f.bak"; then rm "$f.bak"; else echo "updated: $f"; fi
done

echo
echo "Anything still pointing at the old files:"
grep -rn "system-logo\.svg\|favicon\.svg" --include="*.html" --include="*.js" . || echo "  none"
