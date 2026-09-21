import assert from 'node:assert/strict';
import {ATM,atmosphereDensity,extinctionAt,rayleighPhase,miePhase,transmittance,directIrradiance,solarPosition,luminance,exposureForIlluminance} from '../src/atmosphere-model.js';

// These assert transport/energy invariants and compare quadrature convergence,
// rather than mirroring shader branches or snapshotting arbitrary RGB choices.
for(const [name,phase]of [['Rayleigh',rayleighPhase],['Mie',miePhase]]) {
  let integral=0;const n=100000;
  for(let i=0;i<n;i++)integral+=phase(-1+2*(i+.5)/n)*4*Math.PI/n;
  assert(Math.abs(integral-1)<2e-5,`${name} phase conserves unit energy: ${integral}`);
}
assert.deepEqual(atmosphereDensity(25).slice(2),[1]);
for(const h of [0,.02,1,8,25,40,80])for(const mu of [-.3,0,.03,.1,.5,1]) {
  const low=transmittance(h,mu,192),high=transmittance(h,mu,768);
  low.forEach((t,c)=>{assert(t>=0&&t<=1,'Passive atmosphere');assert(Math.abs(t-high[c])<.002,'Optical integration convergence');});
  assert(extinctionAt(h).every(e=>e>=0));
}
const zen=transmittance(.02,1),horizon=transmittance(.02,0);
assert(zen[0]>zen[2],'Short wavelengths scatter more strongly');
assert(horizon.every((t,i)=>t<zen[i]),'Grazing rays have greater optical depth');
assert.deepEqual(directIrradiance(.02,-.3),[0,0,0],'Earth eclipses the sun');
const E=directIrradiance(.02,.8),M=directIrradiance(.02,.8,'moon');
assert(luminance(E)/luminance(M)>400000,'Moonlight has no daytime illumination floor');
const samples=[];
for(let time=18;time<=23.7;time+=.01) {
  const s=solarPosition(time),E=directIrradiance(.02,s.dir[1]);
  samples.push({time,el:s.el,solarLux:luminance(E)*ATM.luxPerUnit});
}
for(let i=1;i<samples.length;i++)assert(samples[i].solarLux<=samples[i-1].solarLux+1e-6,'Continuous falling direct sunlight');
const day=exposureForIlluminance(20),night=exposureForIlluminance(.00002);
assert(night>day*100&&night*.00002<day*20*.05,'Partial exposure adaptation preserves night/day contrast');
console.log(JSON.stringify({pass:true,zenithTransmittance:zen,horizonTransmittance:horizon,
  noonToMoonRatio:luminance(E)/luminance(M),dayExposure:day,nightExposure:night,
  twilight:samples.filter((_,i)=>i%50===0)},null,2));
