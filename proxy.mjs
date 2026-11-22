import http from 'node:http';

const injectedCss = '<link rel="stylesheet" href="/__sketchtation/editor/toolbar.css">';
const injectedJs = '<script type="module" src="/__sketchtation/editor/toolbar.js"></script>';

function targetFor(requestUrl, targetUrl) {
  return new URL(requestUrl, targetUrl);
}

export function proxyRequest(req, res, targetUrl) {
  const target = targetFor(req.url, targetUrl);
  const headers = { ...req.headers, host: target.host, 'accept-encoding': 'identity' };
  const proxyOrigin = `http://${req.headers.host}`;
  if (headers.origin === proxyOrigin) headers.origin = targetUrl.origin;
  if (headers.referer?.startsWith(proxyOrigin)) headers.referer = targetUrl.origin + headers.referer.slice(proxyOrigin.length);
  const upstream = http.request(target, { method: req.method, headers }, response => {
    const type = String(response.headers['content-type'] || '');
    const isHtml = type.includes('text/html') && req.method !== 'HEAD';
    const outgoing = { ...response.headers };
    if (outgoing.location?.startsWith(targetUrl.origin)) {
      outgoing.location = outgoing.location.slice(targetUrl.origin.length) || '/';
    }
    if (!isHtml) {
      res.writeHead(response.statusCode || 502, outgoing);
      response.pipe(res);
      return;
    }
    delete outgoing['content-length'];
    delete outgoing['content-security-policy'];
    outgoing['cache-control'] = 'no-store';
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => {
      let html = Buffer.concat(chunks).toString('utf8');
      html = html.includes('</head>') ? html.replace('</head>', `${injectedCss}</head>`) : injectedCss + html;
      html = html.includes('</body>') ? html.replace('</body>', `${injectedJs}</body>`) : html + injectedJs;
      res.writeHead(response.statusCode || 200, outgoing);
      res.end(html);
    });
  });
  upstream.on('error', error => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Could not connect to ${targetUrl.origin}. Start your website's dev server.\n${error.message}`);
    } else res.destroy(error);
  });
  req.pipe(upstream);
}

export function proxyUpgrade(req, socket, head, targetUrl) {
  const target = targetFor(req.url, targetUrl);
  const headers = { ...req.headers, host: target.host };
  const upstream = http.request(target, { method: 'GET', headers });
  upstream.on('upgrade', (response, peer, peerHead) => {
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`);
    for (const [name, value] of Object.entries(response.headers)) {
      if (Array.isArray(value)) value.forEach(item => socket.write(`${name}: ${item}\r\n`));
      else if (value !== undefined) socket.write(`${name}: ${value}\r\n`);
    }
    socket.write('\r\n');
    if (peerHead.length) socket.write(peerHead);
    if (head.length) peer.write(head);
    peer.pipe(socket).pipe(peer);
  });
  upstream.on('response', response => { socket.end(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n\r\n`); });
  upstream.on('error', () => socket.destroy());
  upstream.end();
}
