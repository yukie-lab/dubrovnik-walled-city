import * as THREE from 'three';

// Batched, solid exhibits and seating. Keep a generous central path between
// the entry and the back wall, with room to walk around both display tables.
export function furnishSponza(r,{box,cylinder,add}) {
  const y=r.floor,back=r.z0+r.wall,cx=r.house.x;
  for(const x of [r.x0+1.2,r.x1-1.2])for(const z of [r.z0+3.1,r.z0+6.4,r.z0+9.7]) {
    box('stone',.55,.22,.55,x,y+.11,z,0xc4b79c);
    cylinder('stone',.16,.20,3.65,x,y+2.045,z,0xd6c9ae,20);
    cylinder('stone',.25,.19,.17,x,y+3.94,z,0xc3b394,20);
    box('stone',.55,.20,.55,x,y+4.125,z,0xd4c5a5);
    box('stone',.33,r.ceiling-y-4.22,.33,x,(r.ceiling+y+4.22)/2,z,0xb9ad94);
  }
  for(const b of r.benches) {
    box('wood',2.4,.09,.64,b.x,y+.49,b.z,0x957b54);
    for(const dx of [-.91,.91])box('stone',.22,.445,.48,b.x+dx,y+.2225,b.z,0xbbb29f);
  }
  const covers=[0x5d796b,0x9b5844,0x82714c,0x546d84,0xb49a6e];
  for(const x of [cx-4.5,cx+4.5]) {
    box('wood',2.5,2.7,.12,x,y+1.35,back+.09,0x594b3b);
    for(const dx of [-1.2,1.2])box('wood',.10,2.8,.46,x+dx,y+1.4,back+.25,0x8c7352);
    for(let row=0;row<4;row++) {
      const sy=y+.15+row*.63;
      box('wood',2.5,.08,.49,x,sy,back+.27,0x8c7352);
      for(let i=0;i<13;i++) {
        const bx=x-1.08+i*.171,h=.36+((i*3+row)%5)*.039,col=covers[(i+row)%covers.length];
        box('objects',.137,h,.26,bx,sy+.04+h/2,back+.25,col);
        for(const yy of [sy+.12,sy+h-.025])box('objects',.10,.014,.008,bx,yy,back+.384,0xc9b37e);
      }
    }
    box('wood',2.6,.13,.53,x,y+2.76,back+.27,0x9b805a);
  }
  r.displays.forEach((d,i)=>{
    box('stone',2.1,.15,1.4,d.x,y+.075,d.z,0xb4a68a);
    box('wood',1.9,.76,1.2,d.x,y+.53,d.z,0x69533f);
    box('wood',2.1,.1,1.4,d.x,y+.96,d.z,0x9d835b);
    box('objects',1.91,.022,1.2,d.x,y+1.02,d.z,0x405852);
    if(i===0) {
      // Model ship with a solid keel, two masts and cream cloth sails.
      const hull=new THREE.SphereGeometry(1,24,12);hull.scale(.76,.17,.25);
      hull.translate(d.x,y+1.28,d.z);add('wood',hull,0x9a7150);
      box('wood',1.4,.035,.36,d.x,y+1.36,d.z,0xc3a875);
      for(const dx of [-.32,.26]) {
        cylinder('wood',.013,.019,.94,d.x+dx,y+1.81,d.z,0x765234,8);
        const sail=new THREE.Shape();sail.moveTo(0,0);sail.lineTo(.42,0);sail.lineTo(0,.60);sail.closePath();
        const g=new THREE.ExtrudeGeometry(sail,{depth:.018,bevelEnabled:false});
        g.translate(d.x+dx+.018,y+1.54,d.z);add('objects',g,0xe2d7b6);
      }
      for(const dx of [-.42,.42])box('wood',.065,.14,.16,d.x+dx,y+1.10,d.z,0xb09a6d);
    }else {
      // An open atlas with bound leaves, a drawn coastline and a brass dial.
      for(const dx of [-.27,.27]) {
        box('wood',.53,.07,.70,d.x+dx,y+1.08,d.z,0x875948);
        box('objects',.48,.035,.65,d.x+dx,y+1.13,d.z,0xe4d9b8);
        for(let k=0;k<7;k++)box('objects',.28,.002,.008,d.x+dx,y+1.149,d.z-.23+k*.058,0x8e957c);
      }
      cylinder('objects',.21,.22,.055,d.x+.72,y+1.07,d.z+.23,0xb39a58,32);
      cylinder('objects',.18,.18,.012,d.x+.72,y+1.105,d.z+.23,0xd5c9a6,32);
      const needle=new THREE.BoxGeometry(.015,.006,.30);needle.rotateY(.5);
      needle.translate(d.x+.72,y+1.114,d.z+.23);add('objects',needle,0x3c5c63);
    }
  });
}
