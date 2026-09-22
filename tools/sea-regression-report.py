"""Compare protected water diagnostics on a baseline-defined water mask."""
import argparse, json, math
from pathlib import Path
from PIL import Image

p=argparse.ArgumentParser();p.add_argument('baseline');p.add_argument('candidate');p.add_argument('--output',required=True)
a=p.parse_args();root=Path('shots/rendercheck');report=[]
def read(prefix,view,phase,mode):
    return Image.open(root/f'{prefix}-{view}-{phase}-{mode}.png').convert('RGB')
for view in ['parapet','shelf']:
    for phase in ['noon','gold','sunset','night']:
        f=read(a.baseline,view,phase,3);n=read(a.baseline,view,phase,4)
        mask=[max(abs(x-y) for x,y in zip(u,v))>1 for u,v in zip(f.get_flattened_data(),n.get_flattened_data())]
        count=sum(mask);entry={'view':view,'phase':phase,'waterPixels':count,'protected':{}}
        if not count: raise RuntimeError('Empty diagnostic water mask')
        for mode in [2,3,4,5,8,12]:
            b=read(a.baseline,view,phase,mode);c=read(a.candidate,view,phase,mode)
            total=0;peak=0;changed=0
            for old,new,keep in zip(b.get_flattened_data(),c.get_flattened_data(),mask):
                if not keep: continue
                diff=[abs(x-y) for x,y in zip(old,new)]
                total+=sum(diff);peak=max(peak,*diff);changed+=max(diff)>0
            entry['protected'][str(mode)]={'meanAbsolute8bit':total/(count*3),'maximum8bit':peak,'changedPixels':changed}
        report.append(entry)
fig=Image.new('RGB',(1200,800),'#f1eee7')
from PIL import ImageDraw, ImageFont
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',15);draw=ImageDraw.Draw(fig)
for i,phase in enumerate(['noon','gold','sunset','night']):
    for j,prefix in enumerate([a.baseline,a.candidate]):
        im=read(prefix,'shelf',phase,0);im.thumbnail((590,365),Image.Resampling.LANCZOS)
        # Separate contact sheets retain full aspect ratio without hiding scene edges.
        if i==0: pass
        sheet=Image.new('RGB',(1200,840),'#f1eee7') if j==0 else sheet
        sheet.paste(im,(j*600,30));ImageDraw.Draw(sheet).text((j*600+8,8),prefix+' / '+phase,font=font,fill='#342e24')
        par=read(prefix,'parapet',phase,0);par.thumbnail((590,365),Image.Resampling.LANCZOS);sheet.paste(par,(j*600,430))
    sheet.save(str(a.output)+'-'+phase+'.png')
# A path calculation is reported separately: changing extinction is an allowed
# spectral transport change, so it must never be misreported as identical T.
sigma0=[1,.16,.03];sigma1=[1,.22,.09];trans=[]
for depth in [.25,.5,1,2]:
    path=depth*(1/math.sin(math.radians(35))+1/math.sin(math.radians(58.0075806175)))
    b=[math.exp(-s*path) for s in sigma0];c=[math.exp(-s*path) for s in sigma1]
    trans.append({'verticalDepthMetres':depth,'roundTripMetres':path,'baselineRGB':b,'candidateRGB':c})
data={'baseline':a.baseline,'candidate':a.candidate,'diagnostics':report,'transmission35DegreeView':trans}
Path(str(a.output)+'.json').write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps(data,indent=2))
if any(v['maximum8bit']>2 or v['meanAbsolute8bit']>.01 for r in report for v in r['protected'].values()):
    raise SystemExit('Protected water diagnostics changed')
