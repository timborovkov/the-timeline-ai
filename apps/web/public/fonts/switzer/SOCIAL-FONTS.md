# Social preview fonts

`Switzer-Social-400.ttf` and `Switzer-Social-600.ttf` are static subsets of the
adjacent `Switzer-Variable.woff2`. Next.js ImageResponse supports TTF but not
WOFF2. Keep the originals and their existing font terms alongside these assets.
These subsets contain ASCII, the curly apostrophe, em dash and middle dot used
by the social card. Extend the subset when adding characters to that card.

To regenerate from the repository root with Python FontTools and Brotli installed:

```python
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

for weight in (400, 600):
    font = TTFont('apps/web/public/fonts/switzer/Switzer-Variable.woff2')
    font = instantiateVariableFont(font, {'wght': weight}, inplace=True)
    font.flavor = None
    subsetter = subset.Subsetter()
    subsetter.populate(unicodes=list(range(32, 127)) + [0x2019, 0x2014, 0x00B7])
    subsetter.subset(font)
    font.save(f'apps/web/public/fonts/switzer/Switzer-Social-{weight}.ttf')
```

Python tooling is only needed to regenerate assets, not to run the application.
