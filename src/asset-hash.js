const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const hex = words => Array.from(words, word => word.toString(16).padStart(8, '0')).join('');
const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits));

// HTTP on a LAN has no SubtleCrypto. Verify the same bytes there too, and use
// these hashes to share embedded textures between detailed meshes and LODs.
export async function sha256(input, subtle = globalThis.crypto?.subtle) {
  const bytes = ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
  if (subtle) {
    const digest = new DataView(await subtle.digest('SHA-256', bytes));
    return hex(Array.from({ length: 8 }, (_, i) => digest.getUint32(i * 4)));
  }
  const state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const words = new Uint32Array(64), tail = new Uint8Array(128);
  const whole = bytes.length - bytes.length % 64, remainder = bytes.length - whole;
  tail.set(bytes.subarray(whole)); tail[remainder] = 0x80;
  const tailLength = remainder < 56 ? 64 : 128, tailView = new DataView(tail.buffer);
  tailView.setUint32(tailLength - 8, Math.floor(bytes.length / 0x20000000));
  tailView.setUint32(tailLength - 4, bytes.length * 8 >>> 0);
  const inputView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < whole + tailLength; offset += 64) {
    const view = offset < whole ? inputView : tailView, start = offset < whole ? offset : offset - whole;
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(start + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15], b = words[i - 2];
      words[i] = words[i - 16] + (rotate(a,7)^rotate(a,18)^(a>>>3)) + words[i - 7] + (rotate(b,17)^rotate(b,19)^(b>>>10));
    }
    let [a,b,c,d,e,f,g,h] = state;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotate(e,6)^rotate(e,11)^rotate(e,25)) + ((e&f)^(~e&g)) + K[i] + words[i]) >>> 0;
      const t2 = ((rotate(a,2)^rotate(a,13)^rotate(a,22)) + ((a&b)^(a&c)^(b&c))) >>> 0;
      h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
    }
    for (const [i, word] of [a,b,c,d,e,f,g,h].entries()) state[i] += word;
    if (offset && offset % 262144 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return hex(state);
}
