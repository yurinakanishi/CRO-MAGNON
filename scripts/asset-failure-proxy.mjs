// Isolated localhost QA surface: force a model-catalog failure without changing
// any production asset or touching existing rooms. No WebSocket connections.
import http from 'node:http';
const server=http.createServer((request,response)=>{
  if(request.url.startsWith('/models/world-assets.json')){response.writeHead(503,{'Content-Type':'text/plain'}).end('Intentional asset-failure QA');return;}
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405).end();return;}
  const upstream=http.request({hostname:'127.0.0.1',port:3001,path:request.url,method:request.method},result=>{
    response.writeHead(result.statusCode,result.headers);result.pipe(response);
  });upstream.on('error',()=>response.writeHead(502).end());upstream.end();
});
server.on('upgrade',(_request,socket)=>socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'));
server.listen(0,'127.0.0.1',()=>console.log(`Asset failure QA: http://127.0.0.1:${server.address().port}/?room=ASSET-FAIL; owned PID ${process.pid}`));
setTimeout(()=>server.close(()=>process.exit(0)),120000);
