// Shared measured rock scale, independent of source UV seams and stretched Z.
export const caveRockShader = `
uniform sampler2D caveLimestone;
vec3 caveRockWeights(vec3 n){
  vec3 w=pow(abs(normalize(n)),vec3(4.0));
  return w/max(.001,w.x+w.y+w.z);
}
vec3 limestoneAt(vec3 p,vec3 w){
  return texture2D(caveLimestone,p.zy/2.8).rgb*w.x
       + texture2D(caveLimestone,p.xz/2.8+vec2(.31,.67)).rgb*w.y
       + texture2D(caveLimestone,p.xy/2.8+vec2(.73,.19)).rgb*w.z;
}
float limestoneRelief(vec3 p,vec3 w){
  // Lower mip levels remove subpixel grain from the height signal, preventing
  // sparkling, black speckles and excessive slopes in distant firelight.
  vec3 stone=texture2D(caveLimestone,p.zy/2.8,2.0).rgb*w.x
       + texture2D(caveLimestone,p.xz/2.8+vec2(.31,.67),2.0).rgb*w.y
       + texture2D(caveLimestone,p.xy/2.8+vec2(.73,.19),2.0).rgb*w.z;
  float pores=dot(stone,vec3(.2126,.7152,.0722));
  return pores*.018;
}
// Surface gradients use derivatives of view-space position, so relief retains
// its physical scale as the player approaches and light moves over the wall.
vec3 caveReliefNormal(vec3 viewPosition,vec3 n,float h){
  vec3 dx=dFdx(viewPosition),dy=dFdy(viewPosition);
  vec3 r1=cross(dy,n),r2=cross(n,dx);
  float det=dot(dx,r1);
  vec3 gradient=sign(det)*(dFdx(h)*r1+dFdy(h)*r2);
  return normalize(max(abs(det),.00000001)*n-gradient);
}
`;
