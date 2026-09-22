import {FOLK_KINEMATICS as K} from './folk-kinematics.js';

// Seat the generated, posed soles on the generated floor. Route samples remain
// a layer hint; they are not a ramp hiding the actual stone. Every resident uses
// this same solver, with no per-person offsets or corrections to geographic data.
export function makeFolkContact(geometry,support) {
  const p=geometry.attributes.position,limb=geometry.attributes.aLimb,soles=[];
  for(let i=0;i<p.count;i++)if(p.getY(i)<.014)
    soles.push({x:p.getX(i),y:p.getY(i),z:p.getZ(i),side:Math.sign(limb.getX(i))});
  const cache=new WeakMap();
  const angles=(side,sine,walk,pose)=>{
    const hip=sine*walk*side*K.walkHip+(pose===3?side*K.restHip*(1-walk):0);
    const knee=Math.max(0,-sine*side)*K.walkKnee*walk;
    const sh=Math.sin(hip),ch=Math.cos(hip),sk=Math.sin(knee),ck=Math.cos(knee);
    const y=-K.kneeY*ck-K.shoeZ*sk+K.kneeY-K.hipY;
    const z=-K.kneeY*sk+K.shoeZ*ck;
    return {sh,ch,sk,ck,sole:y*ch-z*sh+K.hipY-Math.abs(Math.sin(hip+knee))*K.soleRadius};
  };
  return (f,x,layerY,z,rotation,scale,time,walk)=>{
    if(!support)return layerY;
    const previous=cache.get(f);
    if(walk===0&&previous&&previous.x===x&&previous.z===z&&previous.rotation===rotation
      &&previous.scale===scale&&previous.layerY===layerY)return previous.y;
    const sine=Math.sin(f._ph+Math.fround(time)*f._cad);
    const left=angles(-1,sine,walk,f._pose),right=angles(1,sine,walk,f._pose);
    const soleBase=Math.min(left.sole,right.sole),co=Math.cos(rotation),si=Math.sin(rotation);
    let y=-Infinity;
    for(const v of soles) {
      const a=v.side<0?left:right;
      const ky=(v.y-K.kneeY)*a.ck-v.z*a.sk+K.kneeY-K.hipY;
      const kz=(v.y-K.kneeY)*a.sk+v.z*a.ck;
      const py=ky*a.ch-kz*a.sh+K.hipY-soleBase;
      const pz=(ky*a.sh+kz*a.ch)*scale*f.wz,px=v.x*scale*f.wx;
      const wx=x+px*co+pz*si,wz=z-px*si+pz*co;
      const h=support.height(wx,wz,layerY+.55);
      if(h!==null)y=Math.max(y,h-py*scale);
    }
    if(!Number.isFinite(y))y=layerY;
    if(walk===0)cache.set(f,{x,z,rotation,scale,layerY,y});else cache.delete(f);
    return y;
  };
}
