"""Compare a fresh render to previously saved offline photo measurements.

The original photograph is not required and no substitute image is generated.
This does not resample the photograph or claim a new photo-side measurement.
"""
import argparse, colorsys, json
from pathlib import Path
from PIL import Image, ImageDraw

p=argparse.ArgumentParser()
p.add_argument('reference_report');p.add_argument('render');p.add_argument('--output',required=True)
p.add_argument('--config',default='docs/sea-calibration.json')
a=p.parse_args();cached=json.loads(Path(a.reference_report).read_text());config=json.loads(Path(a.config).read_text())
im=Image.open(a.render).convert('RGB')
linear=[v/255/12.92 if v/255<=.04045 else ((v/255+.055)/1.055)**2.4 for v in range(256)]
encode=lambda v:12.92*v if v<=.0031308 else 1.055*v**(1/2.4)-.055
report={'photo':cached['photo'],'photoSHA256':cached['photoSHA256'],'referenceMeasurements':a.reference_report,
        'note':'Original photo was not reread. Uses saved linear-sRGB polygon averages and HSL measurements.',
        'render':a.render,'basis':cached['basis'],'horizon':None,'regions':{}}
for key,polygon in config['renderRegions'].items():
    mask=Image.new('1',im.size);ImageDraw.Draw(mask).polygon([tuple(p) for p in polygon],fill=1)
    bounds=mask.getbbox()
    values=[p for p,m in zip(im.crop(bounds).get_flattened_data(),mask.crop(bounds).get_flattened_data()) if m]
    rgb=[sum(linear[p[k]] for p in values)/len(values) for k in range(3)]
    srgb=[encode(v) for v in rgb];h,l,s=colorsys.rgb_to_hls(*srgb)
    actual={'pixels':len(values),'linearRGB':rgb,'sRGB255':[v*255 for v in srgb],
            'hue':h*360,'saturation':s*100,'lightness':l*100,'bounds':bounds}
    ref=cached['regions'][key]['reference']
    delta={'hue':(actual['hue']-ref['hue']+180)%360-180,
           'saturation':actual['saturation']-ref['saturation'],'lightness':actual['lightness']-ref['lightness']}
    report['regions'][key]={'reference':ref,'render':actual,'delta':delta}
Path(a.output).write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:r['delta'] for k,r in report['regions'].items()},indent=2))
