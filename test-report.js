const fetch = require('node-fetch');

async function test() {
  const res = await fetch('http://127.0.0.1:5000/api/v1/reports/sales');
  console.log(res.status);
  const text = await res.text();
  console.log(text.substring(0, 200));
}
test();
