const http = require('http');

async function testCheckout() {
  const payload = JSON.stringify({
    customer: {
      name: "Test Customer",
      phone: "01700000000",
      address: "Dhaka, Bangladesh",
      district: "Dhaka",
      city: "Dhaka"
    },
    items: [
      {
        productId: "00000000-0000-0000-0000-000000000000",
        quantity: 1
      }
    ],
    paymentMethod: "COD"
  });

  const req = http.request({
    hostname: '127.0.0.1',
    port: 3010,
    path: '/api/storefront/orders',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('STATUS:', res.statusCode);
      console.log('BODY:', data);
    });
  });

  req.on('error', (e) => console.error('REQ ERROR:', e));
  req.write(payload);
  req.end();
}

testCheckout();
