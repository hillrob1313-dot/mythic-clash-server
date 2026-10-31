const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'Mythic Clash lobby server', rooms: rooms.size }));

function makeCode(){
  let code;
  do { code = Array.from({length:6},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join(''); }
  while(rooms.has(code));
  return code;
}
function cleanName(value){
  const name = String(value || 'Player').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,18);
  return name || 'Player';
}
function publicRoom(room){ return { code:room.code, name:room.name, isPublic:room.isPublic, hostId:room.hostId, players:room.players.map(p=>({id:p.id,name:p.name,ready:p.ready||false})) }; }
function emitRoom(room){ io.to(room.code).emit('room:update', publicRoom(room)); }
function removeFromRoom(socket){
  const code=socket.data.roomCode;
  if(!code)return;
  const room=rooms.get(code);
  socket.leave(code); socket.data.roomCode=null;
  if(!room)return;
  room.players=room.players.filter(p=>p.id!==socket.id);
  if(room.players.length===0){rooms.delete(code);return;}
  if(room.hostId===socket.id)room.hostId=room.players[0].id;
  emitRoom(room);
}
function joinRoom(socket, code, name){
  const room=rooms.get(String(code||'').toUpperCase());
  if(!room){socket.emit('room:error','Room not found. Check the code and try again.');return;}
  if(room.players.length>=10){socket.emit('room:error','This room is full (10 players maximum).');return;}
  removeFromRoom(socket);
  room.players.push({id:socket.id,name:cleanName(name)});
  socket.join(room.code);socket.data.roomCode=room.code;
  socket.emit('room:joined',publicRoom(room));emitRoom(room);
}

function battlePublic(room){
 const b=room.battle;if(!b)return null;
 return {players:b.players.map(p=>({id:p.id,name:p.name,hp:p.hp,score:p.score,alive:p.hp>0})),
 currentPlayerId:b.players[b.turnIndex]?.id||null,left:b.left,done:b.done,
 winner:b.winner||null,question:b.question?{id:b.question.id,playerId:b.question.playerId,playerName:b.question.playerName,q:b.question.q,a:b.question.a}:null};
}
function emitBattle(room){if(room.battle)io.to(room.code).emit('onlinebattle:state',battlePublic(room))}
function finishBattle(room,reason){
 const b=room.battle;if(!b||b.done)return;
 b.done=true; if(b.timer)clearInterval(b.timer); if(b.questionTimer)clearTimeout(b.questionTimer);
 const ranked=[...b.players].sort((x,y)=>y.score-x.score||y.hp-x.hp);
 b.winner=ranked[0]?.name||'No winner';io.to(room.code).emit('onlinebattle:ended',{...battlePublic(room),reason});
}
function alivePlayers(b){return b.players.filter(p=>p.hp>0)}
function chooseNextTurn(room){
 const b=room.battle;if(!b||b.done)return;
 if(alivePlayers(b).length<=1){finishBattle(room,'elimination');return}
 for(let n=0;n<b.players.length;n++){
  b.turnIndex=(b.turnIndex+1)%b.players.length;
  if(b.players[b.turnIndex].hp>0)break;
 }
 issueOnlineQuestion(room);
}
function issueOnlineQuestion(room){
 const b=room.battle;if(!b||b.done)return;
 const p=b.players[b.turnIndex];if(!p||p.hp<=0){chooseNextTurn(room);return}
 let pool=b.bank.filter(q=>(b.topic==='Mixed'||q.cat===b.topic)&&(b.difficulty==='Mixed'||q.d===b.difficulty));
 if(!pool.length)pool=b.bank.filter(q=>b.topic==='Mixed'||q.cat===b.topic);
 if(!pool.length)pool=b.bank;
 const q=pool[Math.floor(Math.random()*pool.length)];
 b.question={id:String(Date.now())+'-'+Math.random().toString(36).slice(2),playerId:p.id,playerName:p.name,q:String(q.q),a:q.a.map(String).slice(0,4),correct:Number(q.c),damage:Number(q.damage)||20,points:Number(q.points)||100,seconds:Number(q.t)||15};
 emitBattle(room);
 io.to(room.code).emit('onlinebattle:question',{...b.question});
 if(b.questionTimer)clearTimeout(b.questionTimer);
 b.questionTimer=setTimeout(()=>{
  if(!room.battle||room.battle.done||!room.battle.question)return;
  const current=room.battle.question;room.battle.question=null;
  io.to(room.code).emit('onlinebattle:result',{message:current.playerName+' ran out of time. No damage dealt.'});
  chooseNextTurn(room);
 },Math.max(5,b.question.seconds)*1000);
}
function startOnlineBattle(socket,payload){
 const room=rooms.get(socket.data.roomCode);if(!room){socket.emit('game:error','Join a lobby first.');return}
 if(room.hostId!==socket.id){socket.emit('game:error','Only the host can start the online battle.');return}
 if(room.players.length<2){socket.emit('game:error','At least 2 players must join before starting.');return}
 let bank=Array.isArray(payload?.bank)?payload.bank.filter(q=>q&&typeof q.q==='string'&&Array.isArray(q.a)&&q.a.length>=2&&Number.isInteger(Number(q.c))).slice(0,1500):[];
 if(!bank.length){socket.emit('game:error','No trivia questions were provided.');return}
 if(room.battle?.timer)clearInterval(room.battle.timer);
 const duration=Math.max(60,Math.min(1800,Number(payload.duration)||180));
 room.battle={players:room.players.map(p=>({id:p.id,name:p.name,hp:150,score:0})),bank,
 topic:String(payload.topic||'Mixed'),difficulty:String(payload.difficulty||'Mixed'),
 turnIndex:0,left:duration,done:false,question:null,timer:null,questionTimer:null,winner:null};
 room.battle.timer=setInterval(()=>{
  const b=room.battle;if(!b||b.done)return;
  b.left=Math.max(0,b.left-1);emitBattle(room);
  if(b.left<=0)finishBattle(room,'time');
 },1000);
 issueOnlineQuestion(room);
}

io.on('connection',socket=>{
  socket.data.roomCode=null;
  socket.on('room:create',payload=>{
    if(socket.data.roomCode)removeFromRoom(socket);
    const code=makeCode();
    const room={code,name:String(payload?.roomName||'Mythic Clash Arena').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,30)||'Mythic Clash Arena',isPublic:!!payload?.isPublic,hostId:socket.id,players:[{id:socket.id,name:cleanName(payload?.name)}],battle:null};
    rooms.set(code,room);socket.join(code);socket.data.roomCode=code;
    socket.emit('room:joined',publicRoom(room));
  });
  socket.on('room:join',payload=>joinRoom(socket,payload?.code,payload?.name));
  socket.on('room:joinPublic',payload=>{
    const room=rooms.get(String(payload?.code||'').toUpperCase());
    if(!room||!room.isPublic){socket.emit('room:error','That public room is no longer available. Refresh the list.');return;}
    joinRoom(socket,room.code,payload?.name);
  });
  socket.on('rooms:list',()=>socket.emit('rooms:list',[...rooms.values()].filter(r=>r.isPublic).map(r=>({code:r.code,name:r.name,players:r.players.length})).sort((a,b)=>b.players-a.players)));
  socket.on('onlinebattle:start',payload=>startOnlineBattle(socket,payload));
  socket.on('onlinebattle:answer',payload=>{
   const room=rooms.get(socket.data.roomCode),b=room?.battle,q=b?.question;
   if(!room||!b||b.done||!q||q.id!==payload?.questionId||q.playerId!==socket.id)return;
   const answer=Number(payload.answerIndex),target=b.players.find(p=>p.id===payload.targetId&&p.id!==socket.id&&p.hp>0);
   if(!target||!Number.isInteger(answer)||answer<0||answer>=q.a.length){socket.emit('game:error','Choose a valid living opponent.');return}
   if(b.questionTimer)clearTimeout(b.questionTimer);b.question=null;
   const attacker=b.players.find(p=>p.id===socket.id);let message;
   if(answer===q.correct){target.hp=Math.max(0,target.hp-q.damage);attacker.score+=q.points;message='Correct! '+attacker.name+' deals '+q.damage+' damage to '+target.name+' and earns '+q.points+' points.'}
   else message='Incorrect answer. No damage dealt.';
   io.to(room.code).emit('onlinebattle:result',{message,correct:answer===q.correct,attackerId:attacker.id,targetId:target.id});
   emitBattle(room);setTimeout(()=>chooseNextTurn(room),1400);
  });
  socket.on('room:leave',()=>{const r=rooms.get(socket.data.roomCode);if(r?.battle&&!r.battle.done){if(r.battle.timer)clearInterval(r.battle.timer);if(r.battle.questionTimer)clearTimeout(r.battle.questionTimer);r.battle=null;}removeFromRoom(socket);socket.emit('room:left')});
  socket.on('disconnect',()=>{const r=rooms.get(socket.data.roomCode);if(r?.battle&&!r.battle.done){if(r.battle.timer)clearInterval(r.battle.timer);if(r.battle.questionTimer)clearTimeout(r.battle.questionTimer);r.battle=null;}removeFromRoom(socket)});
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Mythic Clash server listening on ${PORT}`));
