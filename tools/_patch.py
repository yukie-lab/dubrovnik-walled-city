import sys
from PIL import Image
def lin(c):
    c=c/255.0
    return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
im=Image.open(sys.argv[1]).convert('RGB')
for spec in sys.argv[2:]:
    parts=spec.split(',')
    name=parts[0]; x,y,w,h=map(int,parts[1:5])
    px=im.crop((x,y,x+w,y+h)).resize((1,1), Image.BOX).getpixel((0,0))
    L=0.2126*lin(px[0])+0.7152*lin(px[1])+0.0722*lin(px[2])
    br=lin(px[2])/max(lin(px[0]),1e-6)
    print(f"{name:16s} sRGB{px}  lin={L:.4f}  B/R={br:.2f}")
