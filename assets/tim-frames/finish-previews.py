"""Composite actual Blender RGBA renders on the library's neutral background.
Only generated model images are inputs. Also create a local QA contact sheet.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
directory = ROOT/'public/models'
models = json.loads((directory/'models.json').read_text())['models']
archive = ROOT/'assets/tim-frames/rendered-png'
archive.mkdir(exist_ok=True)
for model in models:
    path = directory/model['preview']
    if path.suffix == '.webp' and not path.with_suffix('.png').exists():
        continue
    if path.with_suffix('.png').exists():
        path = path.with_suffix('.png')
    source = Image.open(path).convert('RGBA')
    image = Image.new('RGBA',source.size,(245,246,247,255))
    image.alpha_composite(source)
    target = path.with_suffix('.webp')
    image.convert('RGB').save(target,quality=90,method=6)
    if path.suffix == '.png':
        path.replace(archive/path.name)
    model['preview'] = str(target.relative_to(directory))
(directory/'models.json').write_text(json.dumps({'models':models},ensure_ascii=False,indent=2)+'\n')
for start in range(0,len(models),24):
    batch = models[start:start+24]
    sheet = Image.new('RGB',(1280,6*170),(245,246,247))
    draw = ImageDraw.Draw(sheet)
    for offset,model in enumerate(batch):
        thumb = Image.open(directory/model['preview']).convert('RGB').resize((320,213))
        # Crop empty top/bottom studio margins, retaining the whole frame.
        thumb = thumb.crop((0,35,320,190)).resize((320,155))
        x,y = (offset%4)*320,(offset//4)*170
        sheet.paste(thumb,(x,y+15))
        draw.text((x+8,y+3),model['id'],fill=(20,20,20))
    sheet.save(ROOT/'assets/tim-frames'/f'model-contact-{start//24}.jpg',quality=92)
print(f'Composited {len(models)} actual model renders; generated {(len(models)+23)//24} QA sheets')
