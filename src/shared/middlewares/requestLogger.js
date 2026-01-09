export default function requestLogger(req, res, next) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  const start = Date.now();

  function onFinish() {
    const duration = Date.now() - start;
    const userId = (req.user && req.user.id) ? req.user.id : 'anon';
    console.info(`[req:${id}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms user=${userId}`);
    res.removeListener('finish', onFinish);
    res.removeListener('close', onFinish);
  }

  res.on('finish', onFinish);
  res.on('close', onFinish);
  next();
}
