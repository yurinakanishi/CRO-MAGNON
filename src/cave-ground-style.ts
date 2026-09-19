// One dust palette across the mountain apron and reconstructed cave floor.
export const caveGroundShader = `
float dustHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float dustNoise(vec2 p){
  vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);
  return mix(mix(dustHash(i),dustHash(i+vec2(1,0)),u.x),mix(dustHash(i+vec2(0,1)),dustHash(i+vec2(1,1)),u.x),u.y);
}
float groundGrain(vec2 p){return dustNoise(p*3.2)*.45+dustNoise(p*.63)*.55;}
vec3 caveDust(vec3 source,vec2 p){
  return vec3(.205,.158,.104)*(.88+.20*groundGrain(p));
}
`;
