async function globalSetup() {
  const maxRetries = 60;
  const retryDelay = 2000;

  // Wait for backend to be ready
  console.log('Waiting for backend...');
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch('http://localhost:3002/health');
      const data = await res.json();
      if (data.ready) {
        console.log('Backend is ready.');
        break;
      }
    } catch {
      // not ready yet
    }
    if (i === maxRetries - 1) throw new Error('Backend did not become ready in time');
    await new Promise((r) => setTimeout(r, retryDelay));
  }

  // Wait for frontend to be ready
  console.log('Waiting for frontend...');
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch('http://localhost:5190');
      if (res.ok) {
        console.log('Frontend is ready.');
        break;
      }
    } catch {
      // not ready yet
    }
    if (i === maxRetries - 1) throw new Error('Frontend did not become ready in time');
    await new Promise((r) => setTimeout(r, retryDelay));
  }
}

export default globalSetup;
