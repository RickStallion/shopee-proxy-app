export function sendCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

export function requireAuth(req, res) {
  const expected = process.env.ACCESS_TOKEN;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (expected && got !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }
  return true;
}