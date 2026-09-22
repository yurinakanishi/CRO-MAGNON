# Controller guide product photographs

The A4 landscape guide in `../controller-guide-a4.html` uses official product
photographs instead of the former shared, extra-wide controller drawing.
Downloaded on 2026-09-23 (JST). The product photographs have no visual edits.
Copyright and trademarks remain with the respective manufacturers.

| File | Product page | Image source |
| --- | --- | --- |
| `dualshock-4.png` | [PlayStation DUALSHOCK 4](https://www.playstation.com/en-ca/accessories/dualshock-4-wireless-controller/) | [Official front photograph](https://gmedia.playstation.com/is/image/SIEPDC/ps4-accessories-ds4-jet-black-screen-01-en-28oct20?fmt=png-alpha&wid=1600) |
| `switch-pro-front.png` | Nintendo Switch Brand Guide, product shots, p. 30; asset `HACA_013_imgeKA_F_R_ad-0` | [Nintendo brand guide (public archive)](https://repo.mariocube.com/Marketing/Europe/GUIDELINES/NintendoSwitch_BrandGuide_EU-2_external_05092017_v3.pdf#page=30) |
| `f310.png` | [Logitech F310](https://www.logitechg.com/en-us/shop/p/f310-gamepad) | [Official front photograph](https://resource.logitechg.com/content/dam/gaming/en/products/f310/f310-gallery-1.png) |

The source image dimensions and whitespace viewports are recorded in `PHOTOS`
in the HTML. Both axes use the same scale and `preserveAspectRatio="xMidYMid meet"`.
Arrow targets use source-image coordinates and the same scale. No silhouette,
button, grip, or logo is redrawn. The F310 photo is labelled as F310; the F710
differs in colour and some extra buttons. On user request, unused controls have
no callout, arrow, or caution text. PS4's functional touchpad map instruction remains.
SHARE and the touchpad share one yellow map callout with two arrows, and one
open/close description. The PS4 top row has map, menu, and jump callouts.
Both controls dispatch the `map` action in gameplay and map modes, and `openMap()`
closes an already-open map. The existing input and map-toggle checks cover this.

The Switch front photograph is the original 1000 x 696 image object `Im0`
from page 30 of the Nintendo brand guide. It was decoded from JPEG 2000 with
its alpha channel and saved losslessly as PNG. Its pixel values, aspect ratio,
silhouette, and button positions were not modified. The former angled
`switch-pro.jpg` is retained as source history but is no longer used in the PDF.

Open the HTML in Chrome and print with A4 landscape, no margins, background
graphics enabled and browser headers/footers disabled. The HTML declares the page
size; the output is three pages. Images are local so offline printing works.

Verification: render every final PDF page with Poppler, inspect the images and
arrow endpoints, and measure all 24 callouts for text overflow in Chrome. Confirm
that each photo's screen transformation has equal X and Y scale. This update only
changes the document, not the game or exhibition build.
