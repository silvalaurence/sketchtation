// Pen behavior adapted for Sketchtation from Drawesome's tool ideas.
// Drawesome by Benji Taylor is MIT licensed: https://github.com/benjitaylor/drawesome
export const PENS={
  pencil:{name:'Pencil',size:2,opacity:.85},
  pen:{name:'Pen',size:6,opacity:1},
  fineliner:{name:'Fineliner',size:2,opacity:1},
  marker:{name:'Marker',size:18,opacity:1},
  highlighter:{name:'Highlighter',size:28,opacity:.38,color:'#ffe600'},
  brush:{name:'Brush',size:14,opacity:1},
  fountain:{name:'Fountain',size:8,opacity:1}
};
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
function segmentWidth(stroke,a,b,index,total){
  const distance=Math.hypot(b.x-a.x,b.y-a.y);
  const elapsed=Math.max(1,b.t-a.t);
  const speed=distance/elapsed;
  const pressure=b.pressure&&b.pressure!==.5?b.pressure:clamp(1-speed/2.4,.25,1);
  const size=stroke.size;
  switch(stroke.tool){
    case 'pencil':return size*(.55+.55*pressure);
    case 'pen':return size*(.55+.65*pressure);
    case 'marker':return size*(.82+.26*pressure);
    case 'brush':return size*(.55+.9*pressure)*clamp((total-index)/Math.max(3,total*.18),.2,1);
    case 'fountain':{const angle=Math.atan2(b.y-a.y,b.x-a.x)-Math.PI/4;return size*(.2+.8*Math.abs(Math.sin(angle)));}
    default:return size;
  }
}
export function renderDrawing(ctx,strokes,scale){
  ctx.save();ctx.scale(scale,scale);
  for(const stroke of strokes){
    const pts=stroke.points;
    if(!pts.length)continue;
    ctx.save();
    if(stroke.tool==='highlighter'){
      ctx.globalAlpha=stroke.opacity;
      ctx.strokeStyle=stroke.color;
      ctx.fillStyle=stroke.color;
      ctx.lineWidth=stroke.size;
      ctx.lineCap='square';
      ctx.lineJoin='bevel';
      if(pts.length===1)ctx.fillRect(pts[0].x-stroke.size/2,pts[0].y-stroke.size/2,stroke.size,stroke.size);
      else{ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();}
      ctx.restore();
      continue;
    }
    ctx.globalCompositeOperation=stroke.tool==='erase'?'destination-out':'source-over';
    ctx.strokeStyle=stroke.tool==='erase'?'#000':stroke.color;
    ctx.fillStyle=ctx.strokeStyle;
    ctx.globalAlpha=stroke.tool==='erase'?1:stroke.opacity;
    ctx.lineJoin='round';ctx.lineCap='round';
    if(pts.length===1){ctx.beginPath();ctx.arc(pts[0].x,pts[0].y,stroke.size/2,0,Math.PI*2);ctx.fill();}
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i];
      ctx.lineWidth=segmentWidth(stroke,a,b,i,pts.length);
      if(stroke.tool==='pencil')ctx.globalAlpha=stroke.opacity*(.68+.32*Math.abs(Math.sin(i*12.9898)));
      if(stroke.tool==='marker')ctx.globalAlpha=stroke.opacity*(.9+.1*Math.sin(i*.6));
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}
