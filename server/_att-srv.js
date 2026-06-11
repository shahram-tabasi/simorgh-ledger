import express from 'express';
import cors from 'cors';
import attachAttRelay from './attRelay.js';
const app = express(); app.use(cors()); app.use(express.json()); attachAttRelay(app);
app.listen(4313, () => console.log('att relay on :4313'));
