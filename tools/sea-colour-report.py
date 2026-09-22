"""Offline photo/render metrology. The reference never enters the application."""
import argparse, colorsys, hashlib, json, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

parser=argparse.ArgumentParser()
parser.add_argument('photo')
parser.add_argument('--render')
parser.add_argument('--config',default='docs/sea-calibration.json')
parser.add_argument('--output',default='shots/rendercheck/sea-colour')
args=parser.parse_args()
config=json.loads(Path(args.config).read_text())
photo=Image.open(args.photo).convert('RGB')
render=Image.open(args.render).convert('RGB') if args.render else None
linear=[v/255/12.92 if v/255<=.04045 else ((v/255+.055)/1.055)**2.4 for v in range(256)]
encode=lambda v: 12.92*v if v<=.0031308 else 1.055*v**(1/2.4)-.055
try: font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',16)
except OSError: font=ImageFont.load_default()

def measure(im,polygon):
    mask=Image.new('1',im.size);ImageDraw.Draw(mask).polygon([tuple(p) for p in polygon],fill=1)
    bounds=mask.getbbox();values=[p for p,m in zip(im.crop(bounds).get_flattened_data(),mask.crop(bounds).get_flattened_data()) if m]
    n=len(values)
    avg=[sum(linear[p[k]] for p in values)/n for k in range(3)]
    srgb=[encode(v) for v in avg];h,l,s=colorsys.rgb_to_hls(*srgb)
    return {'pixels':n,'linearRGB':avg,'sRGB255':[v*255 for v in srgb],
            'hue':h*360,'saturation':s*100,'lightness':l*100,
            'zeroRedPercent':sum(p[0]==0 for p in values)/n*100,'bounds':bounds}

def crop(im,polygon):
    p=[tuple(v) for v in polygon]
    x0=max(0,min(v[0] for v in p)-10);y0=max(0,min(v[1] for v in p)-10)
    x1=min(im.width,max(v[0] for v in p)+11);y1=min(im.height,max(v[1] for v in p)+11)
    raw=im.crop((x0,y0,x1,y1))
    ImageDraw.Draw(raw).line([(x-x0,y-y0) for x,y in p+[p[0]]],fill='#f4e4bf',width=1)
    raw.thumbnail((470,175),Image.Resampling.LANCZOS)
    return raw

names={'shelf':'Shallow rock shelf','mid':'Harbour / mid depth','deep':'Deep open water','distant':'Distant open water (not horizon)'}
report={'photo':Path(args.photo).name,'photoSHA256':hashlib.sha256(Path(args.photo).read_bytes()).hexdigest(),
        'basis':'Average linear sRGB, encode to sRGB, then HSL; all polygon pixels, no colour-based rejection.',
        'horizon':None,'regions':{}}
figure=Image.new('RGB',(1000,1020),'#f1eee7');draw=ImageDraw.Draw(figure)
draw.text((20,12),'Photograph reference',font=font,fill='#24221c')
draw.text((520,12),'Rendered comparison' if render else 'Reference region measurements',font=font,fill='#24221c')
overview=photo.copy();ov=ImageDraw.Draw(overview)
for row,(key,poly) in enumerate(config['photoRegions'].items()):
    ref=measure(photo,poly);entry={'reference':ref};y=50+row*230
    draw.text((20,y),names[key],font=font,fill='#24221c')
    figure.paste(crop(photo,poly),(20,y+27))
    label=f"H {ref['hue']:.2f} deg | S {ref['saturation']:.2f}% | L {ref['lightness']:.2f}%"
    draw.text((20,y+201),label,font=font,fill='#24221c')
    ov.line([tuple(p) for p in poly+[poly[0]]],fill='#ffedb9',width=2)
    ov.text(tuple(poly[0]),key,font=font,fill='#ffedb9')
    if render and key in config['renderRegions']:
        rpoly=config['renderRegions'][key];actual=measure(render,rpoly)
        delta={'hue':(actual['hue']-ref['hue']+180)%360-180,
               'saturation':actual['saturation']-ref['saturation'],'lightness':actual['lightness']-ref['lightness']}
        entry.update(render=actual,delta=delta)
        figure.paste(crop(render,rpoly),(520,y+27))
        draw.text((520,y+179),f"H {actual['hue']:.2f} | S {actual['saturation']:.2f} | L {actual['lightness']:.2f}",font=font,fill='#24221c')
        draw.text((520,y+201),f"delta H {delta['hue']:+.2f} deg | S {delta['saturation']:+.2f} pp | L {delta['lightness']:+.2f} pp",font=font,fill='#24221c')
    report['regions'][key]=entry
draw.text((20,995),'No horizon is visible in the photograph. Crops show fixed measurement polygons; no colour correction.',font=font,fill='#24221c')
stem=Path(args.output);stem.parent.mkdir(parents=True,exist_ok=True)
stem.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n')
figure.save(str(stem)+'-crops.png');overview.save(str(stem)+'-reference-regions.png')
print(json.dumps(report,indent=2))
