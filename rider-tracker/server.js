const { PORT, VALHALLA_URL, AUTH_USER, AUTH_PASSWORD } = require('./src/config');

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const authRouter = require('./src/routes/auth');
const ridersRouter = require('./src/routes/riders');
const { authMiddleware } = require('./src/middleware/auth');
const { setupLive } = require('./src/sockets/live');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRouter);
app.use(authMiddleware);
app.use('/api', ridersRouter);

setupLive(io);

server.listen(PORT, () => {
  console.log(`Rider Tracker running at http://localhost:${PORT}`);
  console.log(`Valhalla endpoint: ${VALHALLA_URL}`);
  console.log(`Authentication enabled: ${AUTH_USER && AUTH_PASSWORD ? 'yes' : 'no'}`);
});
