import express from 'express';
import cors from 'cors';
import attachDiagRelay from './diagRelay.js';
process.env.DIAG_KEY='testkey';
const app = express(); app.use(cors()); app.use(express.json()); attachDiagRelay(app);
app.listen(4321, () => console.log('diag srv on :4321'));
