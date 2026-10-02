// Dense draw slots with stable source identities. Removing one leaf fills its
// hole from the end instead of moving every tree that follows it. Growth IDs,
// color, wind and matrices always move together.
export class WoodlandLeafSlots {
  constructor(streams,capacity,treeCount,growth) {
    this.streams=streams;this.count=capacity;
    this.growth=growth;this.touched=new Uint8Array(treeCount);
    this.slotOf=new Int32Array(capacity);this.sourceAt=new Uint32Array(capacity);
    for(let i=0;i<capacity;i++)this.slotOf[i]=this.sourceAt[i]=i;
    // Upload adjacent changes in blocks, avoiding a WebGL call per leaf.
    this.dirty=new Uint8Array(Math.ceil(capacity/64));
    this.first=this.dirty.length;this.last=-1;
  }
  mark(slot) {
    const block=slot>>6;this.dirty[block]=1;
    this.first=Math.min(this.first,block);this.last=Math.max(this.last,block);
  }
  remove(id) {
    const slot=this.slotOf[id],last=--this.count;
    this.touched[this.growth[id*2]]=1;
    if(slot!==last) {
      const moved=this.sourceAt[last];this.sourceAt[slot]=moved;this.slotOf[moved]=slot;
      this.touched[this.growth[moved*2]]=1;
      for(const {attribute,size} of this.streams)
        attribute.array.copyWithin(slot*size,last*size,(last+1)*size);
      this.mark(slot);
    }
    this.slotOf[id]=-1;
  }
  add(id) {
    const slot=this.count++;this.slotOf[id]=slot;this.sourceAt[slot]=id;
    this.touched[this.growth[id*2]]=1;
    for(const {attribute,source,size} of this.streams)
      for(let k=0;k<size;k++)attribute.array[slot*size+k]=source[id*size+k];
    this.mark(slot);
  }
  orderTrees(groups,kept,detail) {
    // Preserve each crown's original primitive order. Nearly coincident leaf
    // surfaces can tie in the depth buffer even though the material is opaque.
    // Only the trees touched by slot moves need to be reordered.
    for(let tree=0;tree<groups.length;tree++)if(this.touched[tree]&&kept[tree]) {
      const g=groups[tree],stride=2**(detail[tree]>>6),slots=[];
      for(let id=g.from;id<g.to;id+=stride)slots.push(this.slotOf[id]);
      slots.sort((a,b)=>a-b);
      for(let i=0,id=g.from;id<g.to;id+=stride,i++) {
        const slot=slots[i];if(this.sourceAt[slot]===id)continue;
        this.slotOf[id]=slot;this.sourceAt[slot]=id;
        for(const {attribute,source,size} of this.streams)
          for(let k=0;k<size;k++)attribute.array[slot*size+k]=source[id*size+k];
        this.mark(slot);
      }
    }
    this.touched.fill(0);
  }
  rebuild(groups,kept,detail) {
    this.slotOf.fill(-1);let count=0;
    for(let i=0;i<groups.length;i++)if(kept[i]) {
      const g=groups[i],stride=2**(detail[i]>>6);
      for(let id=g.from;id<g.to;id+=stride){this.slotOf[id]=count;this.sourceAt[count++]=id;}
    }
    for(const {attribute,source,size} of this.streams) {
      let offset=0;
      for(let i=0;i<groups.length;i++)if(kept[i]) {
        const g=groups[i],stride=2**(detail[i]>>6);
        if(stride===1){attribute.array.set(source.subarray(g.from*size,g.to*size),offset);offset+=(g.to-g.from)*size;}
        else for(let id=g.from;id<g.to;id+=stride)
          for(let k=0;k<size;k++)attribute.array[offset++]=source[id*size+k];
      }
    }
    this.count=count;
    this.touched.fill(0);
    this.first=0;this.last=Math.ceil(count/64)-1;this.dirty.fill(1,0,this.last+1);
  }
  upload() {
    let bytes=0;
    for(let block=this.first;block<=this.last;block++)if(this.dirty[block]) {
      const start=block*64;
      while(block<this.last&&this.dirty[block+1])block++;
      const end=Math.min(this.count,(block+1)*64);
      if(end>start)for(const {attribute,size} of this.streams) {
        // Keep ranges from updates that happened before the next render.
        attribute.addUpdateRange(start*size,(end-start)*size);attribute.needsUpdate=true;
        bytes+=(end-start)*size*attribute.array.BYTES_PER_ELEMENT;
      }
    }
    this.dirty.fill(0,this.first,this.last+1);this.first=this.dirty.length;this.last=-1;
    return bytes;
  }
}
