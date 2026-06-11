import express from 'express'; import cors from 'cors';
const app=express(); app.use(cors()); app.use(express.json({limit:'8mb'}));
let store=null;
app.put('/api/data',(req,res)=>{ store=req.body.blob; res.json({version:1}); });
app.get('/api/data',(req,res)=>res.json({blob:store}));
app.listen(4322,()=>{});
