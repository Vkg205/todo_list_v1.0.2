

// Desktop-safe API layer. Uses Electron preload when available and falls back
// to localStorage so the UI remains fully interactive even if preload fails.
function createDesktopFallbackApi() {
  const storageListeners = new Set();
  const runtimeListeners = new Set();
  const STORAGE_KEY = 'focustodo.todoData';

  const readData = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.error('Failed to read local todo data:', error);
      return null;
    }
  };

  const writeData = todoData => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todoData));
    const change = { todoData: { newValue: todoData } };
    for (const listener of storageListeners) {
      try { listener(change, 'local'); } catch (error) { console.error(error); }
    }
  };

  return {
    storage: {
      local: {
        get: async () => ({ todoData: readData() }),
        set: async payload => {
          if (payload && payload.todoData) writeData(payload.todoData);
          return { ok: true };
        }
      },
      onChanged: {
        addListener: listener => storageListeners.add(listener),
        removeListener: listener => storageListeners.delete(listener)
      }
    },
    runtime: {
      sendMessage: async message => {
        if (message?.type === 'NOTIFY' && 'Notification' in window) {
          try {
            if (Notification.permission === 'default') await Notification.requestPermission();
            if (Notification.permission === 'granted') {
              new Notification(message.title || 'FocusTodo Pro', { body: message.message || '' });
            }
          } catch (error) { console.warn('Notification failed:', error); }
        }
        return { ok: true };
      },
      onMessage: {
        addListener: listener => runtimeListeners.add(listener),
        removeListener: listener => runtimeListeners.delete(listener)
      }
    },
    tabs: { query: async () => [{ title: '', url: '' }] },
    sidePanel: { open: async () => ({ ok: true }) }
  };
}

const chrome = window.focusTodoApi?.storage?.local
  ? window.focusTodoApi
  : createDesktopFallbackApi();

// One-time migration: older v1.0.1 builds may have stored tasks in renderer localStorage.
// When the Electron persistence bridge is available, migrate that data into the
// durable JSON file managed by the main process.
async function migrateLegacyLocalStorage() {
  if (!window.focusTodoApi?.storage?.local) return;
  try {
    const legacyRaw = localStorage.getItem('focustodo.todoData');
    if (!legacyRaw) return;
    const legacy = JSON.parse(legacyRaw);
    const current = await window.focusTodoApi.storage.local.get(['todoData']);
    const currentTasks = current?.todoData?.tasks || [];
    const legacyTasks = legacy?.tasks || [];
    if (currentTasks.length === 0 && legacyTasks.length > 0) {
      await window.focusTodoApi.storage.local.set({ todoData: legacy });
    }
    localStorage.removeItem('focustodo.todoData');
  } catch (error) {
    console.warn('Legacy data migration failed:', error);
  }
}

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DEFAULT_DATA={tasks:[],lists:[{id:"inbox",name:"收集箱",color:"#5b7cfa",icon:"📥",archived:false}],settings:{theme:"system",fontSize:14,defaultList:"inbox",defaultPriority:"medium",autoArchive:false,overdueHighlight:true,quietStart:"22:00",quietEnd:"07:00",notifications:true},trash:[],habits:[],version:1};
let data=structuredClone(DEFAULT_DATA), state={view:"today",mode:"list",sort:"custom",selected:new Set(),search:"",calendarDate:new Date()};

async function load(){
 await migrateLegacyLocalStorage();
 const got=await chrome.storage.local.get(["todoData"]); data=got.todoData||structuredClone(DEFAULT_DATA);
 data.tasks ||= []; data.lists ||= DEFAULT_DATA.lists; data.settings={...DEFAULT_DATA.settings,...(data.settings||{})};data.trash ||= [];
 applyTheme(); bind(); render(); checkIncoming();
 chrome.storage.onChanged.addListener(ch=>{if(ch.todoData){data=ch.todoData.newValue;render()}});
}
async function save(rebuild=true){await chrome.storage.local.set({todoData:data});if(rebuild)chrome.runtime.sendMessage({type:"REBUILD_ALARMS"}).catch(()=>{});}
function uid(){return crypto.randomUUID()}
function fmtDate(v,withTime=true){if(!v)return "";const d=new Date(v);return new Intl.DateTimeFormat("zh-CN",{month:"numeric",day:"numeric",...(withTime?{hour:"2-digit",minute:"2-digit"}:{})}).format(d)}
function dayKey(v){const d=new Date(v);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function isToday(v){return v&&dayKey(v)===dayKey(Date.now())}
function startDay(v=Date.now()){const d=new Date(v);d.setHours(0,0,0,0);return d.getTime()}
function priorityLabel(p){return {high:"高优先级",medium:"中优先级",low:"低优先级"}[p]||"中优先级"}
function esc(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function listById(id){return data.lists.find(x=>x.id===id)||{name:"未知",icon:"📋",color:"#999"}}
function toast(msg){const n=document.createElement("div");n.className="toast";n.textContent=msg;$("#toastRoot").append(n);setTimeout(()=>n.remove(),2700)}
function applyTheme(){const t=data.settings.theme;document.body.classList.toggle("dark",t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme:dark)").matches));document.documentElement.style.fontSize=(data.settings.fontSize||14)+"px"}

function bind(){
 $("#menuBtn").onclick=()=>$("#sidebar").classList.toggle("open");
 $("#newTaskBtn").onclick=()=>openTaskModal();
 $("#fab").onclick=()=>openTaskModal();
 $("#quickAddBtn").onclick=quickAdd;$("#quickInput").onkeydown=e=>{if(e.key==="Enter")quickAdd()};
 $("#voiceBtn").onclick=voiceInput;$("#calendarBtn").onclick=()=>{state.view="calendar";render()};
 $("#themeBtn").onclick=async()=>{data.settings.theme=document.body.classList.contains("dark")?"light":"dark";applyTheme();await save(false)};
 $("#sortSelect").onchange=e=>{state.sort=e.target.value;renderTasks()};
 $("#searchBtn").onclick=()=>openSearch();
 $("#addListBtn").onclick=()=>openListModal();
 $("#smartViews").onclick=e=>navClick(e);$("#listNav").onclick=e=>navClick(e);$(".sidebar-bottom").onclick=e=>navClick(e);
 $("#tagCloud").onclick=e=>{if(e.target.dataset.tag){state.view="tag:"+e.target.dataset.tag;render()}};
 $("#taskList").onclick=taskClick;$("#taskList").ondblclick=e=>{const c=e.target.closest(".task-card");if(c)openTaskModal(c.dataset.id)};
 $("#bulkBar").onclick=bulkAction;
 $("#moreBtn").onclick=()=>openTools();
 chrome.runtime.onMessage.addListener(msg=>{if(msg.type==="FOCUS_QUICK_ADD")$("#quickInput").focus()});
 document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openSearch()}if(e.key==="Escape")closeModal()});
}
function navClick(e){const b=e.target.closest("[data-view]");if(!b)return;state.view=b.dataset.view;state.selected.clear();$("#sidebar").classList.remove("open");render()}

function render(){
 renderSidebar();$$("main>section").forEach(x=>x.classList.add("hidden"));
 if(state.view==="calendar"){$("#calendarView").classList.remove("hidden");renderCalendar()}
 else if(state.view==="stats"){$("#statsView").classList.remove("hidden");renderStats()}
 else if(state.view==="settings"){$("#settingsView").classList.remove("hidden");renderSettings()}
 else{$("#taskView").classList.remove("hidden");renderTasks()}
}
function renderSidebar(){
 const now=Date.now(), active=data.tasks.filter(t=>!t.archived);
 const smart=[
  ["all","▣","全部任务",active.filter(t=>!t.completed).length],
  ["today","☀","今日待办",active.filter(t=>!t.completed&&isToday(t.dueAt)).length],
  ["overdue","⚠","逾期任务",active.filter(t=>!t.completed&&t.dueAt&&new Date(t.dueAt).getTime()<startDay()).length],
  ["upcoming","◷","即将到期",active.filter(t=>!t.completed&&t.dueAt&&new Date(t.dueAt).getTime()>=startDay()).length],
  ["nodate","○","无日期任务",active.filter(t=>!t.completed&&!t.dueAt).length],
  ["completed","✓","已完成",active.filter(t=>t.completed).length],
  ["trash","♲","回收站",data.trash.length]
 ];
 $("#smartViews").innerHTML=smart.map(([v,i,n,c])=>`<button data-view="${v}" class="${state.view===v?"active":""}"><span>${i} ${n}</span><span class="count">${c}</span></button>`).join("");
 $("#listNav").innerHTML=data.lists.filter(l=>!l.archived).map(l=>`<button data-view="list:${l.id}" class="${state.view===`list:${l.id}`?"active":""}"><span><i style="color:${l.color}">●</i> ${esc(l.icon)} ${esc(l.name)}</span><span class="count">${active.filter(t=>!t.completed&&t.listId===l.id).length}</span></button>`).join("");
 const tags=[...new Set(data.tasks.flatMap(t=>t.tags||[]))].slice(0,18);
 $("#tagCloud").innerHTML=tags.map(t=>`<span class="tag" data-tag="${esc(t)}">#${esc(t)}</span>`).join("")||'<span class="count">暂无标签</span>';
}
function filteredTasks(){
 let arr=data.tasks.filter(t=>!t.archived);
 const now=Date.now(), week=now+7*86400000;
 if(state.view==="today")arr=arr.filter(t=>isToday(t.dueAt)&&!t.completed);
 else if(state.view==="all")arr=arr.filter(t=>!t.completed);
 else if(state.view==="overdue")arr=arr.filter(t=>!t.completed&&t.dueAt&&new Date(t.dueAt).getTime()<startDay());
 else if(state.view==="upcoming")arr=arr.filter(t=>!t.completed&&t.dueAt&&new Date(t.dueAt).getTime()>=startDay()&&new Date(t.dueAt).getTime()<=week);
 else if(state.view==="nodate")arr=arr.filter(t=>!t.completed&&!t.dueAt);
 else if(state.view==="completed")arr=arr.filter(t=>t.completed);
 else if(state.view.startsWith("list:"))arr=arr.filter(t=>t.listId===state.view.slice(5)&&!t.completed);
 else if(state.view.startsWith("tag:"))arr=arr.filter(t=>(t.tags||[]).includes(state.view.slice(4))&&!t.completed);
 if(state.search){const q=state.search.toLowerCase();arr=arr.filter(t=>[t.title,t.notes,...(t.tags||[])].join(" ").toLowerCase().includes(q))}
 const rank={high:0,medium:1,low:2};
 if(state.sort==="due")arr.sort((a,b)=>(a.dueAt?new Date(a.dueAt):Infinity)-(b.dueAt?new Date(b.dueAt):Infinity));
 else if(state.sort==="priority")arr.sort((a,b)=>rank[a.priority]-rank[b.priority]);
 else if(state.sort==="created")arr.sort((a,b)=>b.createdAt-a.createdAt);
 else arr.sort((a,b)=>(b.priority==="high")-(a.priority==="high") || (a.order||0)-(b.order||0));
 return arr;
}
function titleForView(){
 if(state.view.startsWith("list:"))return listById(state.view.slice(5)).name;
 if(state.view.startsWith("tag:"))return "#"+state.view.slice(4);
 return {all:"全部任务",today:"今日待办",overdue:"逾期任务",upcoming:"未来 7 天",nodate:"无日期任务",completed:"已完成",trash:"回收站"}[state.view]||"待办";
}
function renderTasks(){
 $("#viewTitle").textContent=titleForView();const arr=state.view==="trash"?data.trash:filteredTasks();
 $("#viewSubtitle").textContent=`${arr.length} 项任务 · ${new Intl.DateTimeFormat("zh-CN",{weekday:"long",month:"long",day:"numeric"}).format(new Date())}`;
 $("#sortSelect").value=state.sort;
 if(state.view==="trash"){renderTrash();return}
 $("#taskList").className=state.mode==="board"?"board":"";
 $$(".seg").forEach(b=>b.classList.toggle("active",b.dataset.mode===state.mode));
 $$(".seg").forEach(b=>b.onclick=()=>{state.mode=b.dataset.mode;renderTasks()});
 if(state.mode==="board"){renderBoard(arr)}else{$("#taskList").innerHTML=arr.map(taskHtml).join("");enableDrag()}
 $("#emptyState").classList.toggle("hidden",arr.length>0);
 $("#bulkBar").classList.toggle("hidden",state.selected.size===0);$("#selectedCount").textContent=state.selected.size+" 项";
}
function taskHtml(t){
 const sub=t.subtasks||[], done=sub.filter(s=>s.completed).length, pct=sub.length?Math.round(done/sub.length*100):0;
 const overdue=data.settings.overdueHighlight&&t.dueAt&&!t.completed&&new Date(t.dueAt).getTime()<Date.now();
 return `<article class="task-card ${overdue?"overdue":""} ${state.selected.has(t.id)?"selected":""}" draggable="true" data-id="${t.id}">
 <button class="check ${t.completed?"done":""}" data-action="toggle">${t.completed?"✓":""}</button>
 <div><div class="task-title ${t.completed?"done":""}">${esc(t.title)}</div>${t.notes?`<div class="task-notes">${esc(t.notes.slice(0,180))}</div>`:""}
 <div class="meta">${t.dueAt?`<span class="pill ${overdue?"high":""}">🕒 ${fmtDate(t.dueAt)}</span>`:""}<span class="pill ${t.priority}">${priorityLabel(t.priority)}</span><span class="pill">${esc(listById(t.listId).icon)} ${esc(listById(t.listId).name)}</span>${(t.tags||[]).map(x=>`<span class="pill">#${esc(x)}</span>`).join("")}${t.repeat?`<span class="pill">↻ ${esc(t.repeat)}</span>`:""}</div>
 ${sub.length?`<div class="progress"><i style="width:${pct}%"></i></div><div class="task-notes">${done}/${sub.length} 子任务完成</div>`:""}</div>
 <button class="task-menu" data-action="menu">•••</button></article>`
}
function renderBoard(arr){
 const groups=[["high","高优先级"],["medium","中优先级"],["low","低优先级"]];
 $("#taskList").innerHTML=groups.map(([p,n])=>`<div class="board-col" data-priority="${p}"><h3>${n} · ${arr.filter(t=>t.priority===p).length}</h3>${arr.filter(t=>t.priority===p).map(taskHtml).join("")}</div>`).join("");enableDrag()
}
function enableDrag(){
 let dragged=null;
 $$(".task-card").forEach(c=>{c.ondragstart=()=>{dragged=c.dataset.id;c.classList.add("dragging")};c.ondragend=()=>c.classList.remove("dragging");c.ondragover=e=>e.preventDefault();c.ondrop=async e=>{e.preventDefault();const target=c.dataset.id;if(!dragged||dragged===target)return;const a=data.tasks.find(x=>x.id===dragged),b=data.tasks.find(x=>x.id===target);const tmp=a.order;a.order=b.order;b.order=tmp;await save(false);renderTasks()}});
 $$(".board-col").forEach(col=>{col.ondragover=e=>e.preventDefault();col.ondrop=async()=>{if(!dragged)return;const t=data.tasks.find(x=>x.id===dragged);t.priority=col.dataset.priority;await save(false);renderTasks()}});
}
async function taskClick(e){
 const card=e.target.closest(".task-card");if(!card)return;const id=card.dataset.id,t=data.tasks.find(x=>x.id===id);
 if(e.target.closest('[data-action="toggle"]')){t.completed=!t.completed;t.completedAt=t.completed?Date.now():null;t.updatedAt=Date.now();if(t.completed&&data.settings.autoArchive)t.archived=true;await save();toast(t.completed?"任务已完成":"已恢复任务");return}
 if(e.target.closest('[data-action="menu"]')){openTaskMenu(t);return}
 if(e.ctrlKey||e.metaKey||e.shiftKey){state.selected.has(id)?state.selected.delete(id):state.selected.add(id);renderTasks()}
}
function openTaskMenu(t){
 modal(`<h2>${esc(t.title)}</h2><div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap">
 <button data-x="edit">编辑</button><button data-x="duplicate">复制</button><button data-x="pomodoro">🍅 专注 25 分钟</button><button data-x="share">分享文本</button><button data-x="delete" class="danger">移入回收站</button></div>`);
 $$("[data-x]").forEach(b=>b.onclick=async()=>{const x=b.dataset.x;closeModal();
 if(x==="edit")openTaskModal(t.id);if(x==="duplicate"){const n=structuredClone(t);n.id=uid();n.title+="（副本）";n.createdAt=n.updatedAt=Date.now();data.tasks.unshift(n);await save();toast("已复制")}
 if(x==="delete")await trashTask(t.id);if(x==="pomodoro")openPomodoro(t);if(x==="share"){navigator.clipboard.writeText(`${t.title}${t.dueAt?`\n截止：${fmtDate(t.dueAt)}`:""}${t.notes?`\n${t.notes}`:""}`);toast("分享文本已复制")}})
}
async function trashTask(id){const i=data.tasks.findIndex(t=>t.id===id);if(i<0)return;data.trash.unshift({...data.tasks[i],deletedAt:Date.now()});data.tasks.splice(i,1);await save();toast("已移入回收站")}
function renderTrash(){
 $("#taskList").className="";$("#taskList").innerHTML=data.trash.map(t=>`<article class="task-card" data-id="${t.id}"><span>🗑</span><div><div class="task-title">${esc(t.title)}</div><div class="task-notes">删除于 ${fmtDate(t.deletedAt)}</div></div><div><button data-restore="${t.id}">恢复</button> <button data-purge="${t.id}" class="danger">彻底删除</button></div></article>`).join("");
 $("#emptyState").classList.toggle("hidden",data.trash.length>0);
 $$("[data-restore]").forEach(b=>b.onclick=async()=>{const i=data.trash.findIndex(t=>t.id===b.dataset.restore);const t=data.trash.splice(i,1)[0];delete t.deletedAt;data.tasks.unshift(t);await save();toast("任务已恢复")});
 $$("[data-purge]").forEach(b=>b.onclick=async()=>{data.trash=data.trash.filter(t=>t.id!==b.dataset.purge);await save(false);render()});
}
async function quickAdd(){
 const input=$("#quickInput"), raw=input.value.trim();if(!raw)return;
 const parsed=parseNatural(raw),now=Date.now();data.tasks.unshift({id:uid(),title:parsed.title||raw,notes:"",listId:parsed.listId||data.settings.defaultList,tags:parsed.tags,priority:parsed.priority||data.settings.defaultPriority,completed:false,archived:false,createdAt:now,updatedAt:now,dueAt:parsed.dueAt,reminders:parsed.dueAt?[30]:[],repeat:null,subtasks:[],attachments:[],order:now});
 input.value="";await save();toast("待办已添加")
}
function parseNatural(raw){
 let title=raw,dueAt=null,priority=null,listId=null,tags=[];
 const now=new Date(), d=new Date(now);d.setSeconds(0,0);
 if(/今天/.test(raw)){d.setHours(18,0,0,0);dueAt=d.toISOString();title=title.replace("今天","")}
 if(/明天/.test(raw)){d.setDate(d.getDate()+1);d.setHours(9,0,0,0);dueAt=d.toISOString();title=title.replace("明天","")}
 if(/下周/.test(raw)){d.setDate(d.getDate()+7);d.setHours(9,0,0,0);dueAt=d.toISOString();title=title.replace("下周","")}
 const tm=raw.match(/(\d{1,2})[点:时](\d{1,2})?/);if(tm){d.setHours(+tm[1],+(tm[2]||0),0,0);dueAt=d.toISOString();title=title.replace(tm[0],"")}
 if(/!高/.test(raw)){priority="high";title=title.replace("!高","")}else if(/!低/.test(raw)){priority="low";title=title.replace("!低","")}
 const hs=[...raw.matchAll(/#([\w\u4e00-\u9fa5-]+)/g)].map(m=>m[1]);tags=hs;for(const tag of hs){const l=data.lists.find(x=>x.name===tag);if(l)listId=l.id;title=title.replace("#"+tag,"")}
 return {title:title.trim(),dueAt,priority,listId,tags}
}
function voiceInput(){
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){toast("当前浏览器不支持语音识别");return}
 const r=new SR();r.lang="zh-CN";r.interimResults=false;r.onresult=e=>{$("#quickInput").value=e.results[0][0].transcript;quickAdd()};r.onerror=()=>toast("语音识别失败，请检查麦克风权限");r.start();toast("正在聆听…")
}
function openTaskModal(id=null){
 const old=id?data.tasks.find(t=>t.id===id):null, t=old||{title:"",notes:"",listId:data.settings.defaultList,tags:[],priority:data.settings.defaultPriority,dueAt:null,reminders:[30],repeat:null,subtasks:[],attachments:[]};
 const local=t.dueAt?new Date(new Date(t.dueAt).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):"";
 modal(`<h2>${old?"编辑待办":"新建待办"}</h2><div class="form-grid">
 <div class="field full"><label>标题</label><input id="fTitle" value="${esc(t.title)}" placeholder="要完成什么？"></div>
 <div class="field full"><label>详细备注</label><textarea id="fNotes" placeholder="补充说明、粘贴链接或清单…">${esc(t.notes||"")}</textarea></div>
 <div class="field"><label>清单</label><select id="fList">${data.lists.filter(l=>!l.archived).map(l=>`<option value="${l.id}" ${l.id===t.listId?"selected":""}>${esc(l.icon)} ${esc(l.name)}</option>`).join("")}</select></div>
 <div class="field"><label>优先级</label><select id="fPriority"><option value="high" ${t.priority==="high"?"selected":""}>高</option><option value="medium" ${t.priority==="medium"?"selected":""}>中</option><option value="low" ${t.priority==="low"?"selected":""}>低</option></select></div>
 <div class="field"><label>截止时间</label><input id="fDue" type="datetime-local" value="${local}"></div>
 <div class="field"><label>重复</label><select id="fRepeat"><option value="">不重复</option>${["每日","工作日","每周","每月","每年"].map(x=>`<option ${t.repeat===x?"selected":""}>${x}</option>`).join("")}</select></div>
 <div class="field"><label>提前提醒（分钟，逗号分隔）</label><input id="fReminders" value="${(t.reminders||[]).join(",")}"></div>
 <div class="field"><label>标签（逗号分隔）</label><input id="fTags" value="${esc((t.tags||[]).join(","))}"></div>
 <div class="field full"><label>子任务</label><div id="subs">${(t.subtasks||[]).map((s,i)=>subRow(s,i)).join("")}</div><button id="addSub">＋ 添加子任务</button></div>
 <div class="field full"><label>附件链接</label><input id="fAttach" placeholder="粘贴文件或网页链接" value="${esc(t.attachments?.[0]?.url||"")}"></div></div>
 <div class="modal-actions">${old?'<button id="deleteTask" class="danger">删除</button>':""}<button data-close>取消</button><button class="save" id="saveTask">保存</button></div>`);
 $("#fTitle").focus();$("#addSub").onclick=()=>$("#subs").insertAdjacentHTML("beforeend",subRow({title:"",completed:false},Date.now()));
 $("#saveTask").onclick=async()=>{const title=$("#fTitle").value.trim();if(!title){toast("请输入标题");return}
 const now=Date.now(), obj={...(old||{}),id:old?.id||uid(),title,notes:$("#fNotes").value,listId:$("#fList").value,priority:$("#fPriority").value,dueAt:$("#fDue").value?new Date($("#fDue").value).toISOString():null,repeat:$("#fRepeat").value||null,reminders:$("#fReminders").value.split(",").map(Number).filter(x=>Number.isFinite(x)&&x>=0),tags:$("#fTags").value.split(/[,，]/).map(x=>x.trim()).filter(Boolean),subtasks:$$(".subtask-row").map(r=>({id:r.dataset.id||uid(),title:r.querySelector("[data-subtitle]").value.trim(),completed:r.querySelector("[data-subdone]").checked})).filter(x=>x.title),attachments:$("#fAttach").value?[{type:"link",url:$("#fAttach").value}]:[],completed:old?.completed||false,archived:old?.archived||false,createdAt:old?.createdAt||now,updatedAt:now,order:old?.order||now};
 if(old)Object.assign(old,obj);else data.tasks.unshift(obj);await save();closeModal();toast(old?"待办已更新":"待办已创建")};
 if(old)$("#deleteTask").onclick=async()=>{closeModal();await trashTask(old.id)}
}
function subRow(s,i){return `<div class="subtask-row" data-id="${s.id||uid()}"><input type="checkbox" data-subdone ${s.completed?"checked":""}><input type="text" data-subtitle value="${esc(s.title||"")}" placeholder="子任务"><button onclick="this.parentElement.remove()">×</button></div>`}

function modal(html){$("#modalRoot").innerHTML=`<div class="modal-overlay"><div class="modal">${html}</div></div>`;$$("[data-close]").forEach(x=>x.onclick=closeModal);$(".modal-overlay").onclick=e=>{if(e.target.classList.contains("modal-overlay"))closeModal()}}
function closeModal(){$("#modalRoot").innerHTML=""}
async function bulkAction(e){
 const a=e.target.dataset.bulk;if(!a)return;if(a==="cancel"){state.selected.clear();renderTasks();return}
 const ids=[...state.selected];
 if(a==="complete"){data.tasks.forEach(t=>{if(ids.includes(t.id)){t.completed=true;t.completedAt=Date.now()}})}
 if(a==="delete"){for(const id of ids){const i=data.tasks.findIndex(t=>t.id===id);if(i>=0){data.trash.unshift({...data.tasks[i],deletedAt:Date.now()});data.tasks.splice(i,1)}}}
 if(a==="move"){const name=prompt("输入目标清单名称");const l=data.lists.find(x=>x.name===name);if(!l){toast("未找到该清单");return}data.tasks.forEach(t=>{if(ids.includes(t.id))t.listId=l.id})}
 state.selected.clear();await save();renderTasks()
}
function openListModal(){
 modal(`<h2>新建清单</h2><div class="form-grid"><div class="field full"><label>名称</label><input id="lName" placeholder="例如：项目 A"></div><div class="field"><label>图标</label><input id="lIcon" value="📋"></div><div class="field"><label>颜色</label><input id="lColor" type="color" value="#5b7cfa"></div></div><div class="modal-actions"><button data-close>取消</button><button class="save" id="saveList">创建</button></div>`);
 $("#saveList").onclick=async()=>{const name=$("#lName").value.trim();if(!name)return;data.lists.push({id:uid(),name,icon:$("#lIcon").value||"📋",color:$("#lColor").value,archived:false});await save(false);closeModal();render()}
}
function openSearch(){
 modal(`<h2>搜索与组合筛选</h2><div class="field"><input id="searchInput" value="${esc(state.search)}" placeholder="搜索标题、备注、标签"></div><div class="modal-actions"><button id="clearSearch">清除</button><button class="save" id="doSearch">搜索</button></div>`);
 $("#searchInput").focus();$("#doSearch").onclick=()=>{state.search=$("#searchInput").value.trim();state.view="all";closeModal();render()};$("#clearSearch").onclick=()=>{state.search="";closeModal();render()}
}
function renderCalendar(){
 const base=state.calendarDate,y=base.getFullYear(),m=base.getMonth(),first=new Date(y,m,1),start=new Date(y,m,1-first.getDay());
 let days=[];for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);days.push(d)}
 $("#calendarView").innerHTML=`<div class="calendar-head"><button id="calBack">←</button><h1>${y} 年 ${m+1} 月</h1><div><button id="calToday">今天</button><button id="calNext">→</button></div></div><div class="calendar-grid">${["日","一","二","三","四","五","六"].map(x=>`<b style="text-align:center">${x}</b>`).join("")}${days.map(d=>{const ts=data.tasks.filter(t=>t.dueAt&&dayKey(t.dueAt)===dayKey(d)&&!t.archived);return `<div class="cal-day ${d.getMonth()!==m?"muted":""} ${isToday(d)?"today":""}" data-day="${dayKey(d)}"><span class="cal-num">${d.getDate()}</span>${ts.slice(0,4).map(t=>`<div class="cal-task" data-id="${t.id}">${esc(t.title)}</div>`).join("")}${ts.length>4?`<small>+${ts.length-4}</small>`:""}</div>`}).join("")}</div>`;
 $("#calBack").onclick=()=>{state.calendarDate=new Date(y,m-1,1);renderCalendar()};$("#calNext").onclick=()=>{state.calendarDate=new Date(y,m+1,1);renderCalendar()};$("#calToday").onclick=()=>{state.calendarDate=new Date();renderCalendar()};
 $$(".cal-task").forEach(x=>x.onclick=e=>{e.stopPropagation();openTaskModal(x.dataset.id)});$$(".cal-day").forEach(x=>x.onclick=()=>{state.view="all";state.search="";render();toast(`${x.dataset.day} 的任务已在日历中显示`)})
}
function renderStats(){
 const all=data.tasks.filter(t=>!t.archived),done=all.filter(t=>t.completed),todayDone=done.filter(t=>isToday(t.completedAt)),todayTotal=all.filter(t=>isToday(t.createdAt)||isToday(t.dueAt));
 let streak=0,d=new Date();for(let i=0;i<365;i++){const k=dayKey(d);if(done.some(t=>t.completedAt&&dayKey(t.completedAt)===k)){streak++;d.setDate(d.getDate()-1)}else break}
 const byList=data.lists.map(l=>({name:l.name,count:all.filter(t=>t.listId===l.id).length})).filter(x=>x.count),max=Math.max(1,...byList.map(x=>x.count));
 $("#statsView").innerHTML=`<div class="view-head"><div><h1>数据统计</h1><p>了解你的任务完成节奏</p></div></div><div class="stats-cards"><div class="stat"><b>${all.length}</b><span>任务总数</span></div><div class="stat"><b>${done.length}</b><span>累计完成</span></div><div class="stat"><b>${todayTotal.length?Math.round(todayDone.length/todayTotal.length*100):0}%</b><span>今日完成率</span></div><div class="stat"><b>${streak}</b><span>连续完成天数</span></div></div><div class="chart"><h3>各清单任务占比</h3>${byList.map(x=>`<div class="bar-row"><span>${esc(x.name)}</span><div class="bar-bg"><div class="bar-fill" style="width:${x.count/max*100}%"></div></div><b>${x.count}</b></div>`).join("")||"<p>暂无数据</p>"}</div><div class="chart"><h3>最近 7 天完成数</h3>${[6,5,4,3,2,1,0].map(i=>{const d=new Date();d.setDate(d.getDate()-i);const c=done.filter(t=>t.completedAt&&dayKey(t.completedAt)===dayKey(d)).length;return `<div class="bar-row"><span>${d.getMonth()+1}/${d.getDate()}</span><div class="bar-bg"><div class="bar-fill" style="width:${Math.min(100,c*20)}%"></div></div><b>${c}</b></div>`}).join("")}</div>`
}
function renderSettings(){
 const s=data.settings;
 $("#settingsView").innerHTML=`<div class="view-head"><div><h1>设置</h1><p>个性化你的待办体验</p></div></div>
 <div class="settings-card"><h3>外观</h3><div class="setting-row"><span>主题</span><select id="setTheme"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></div><div class="setting-row"><span>字体大小</span><input id="setFont" type="range" min="12" max="18" value="${s.fontSize}"></div></div>
 <div class="settings-card"><h3>行为与通知</h3>${toggleRow("自动归档已完成任务","autoArchive",s.autoArchive)}${toggleRow("逾期任务标红","overdueHighlight",s.overdueHighlight)}${toggleRow("系统通知","notifications",s.notifications)}<div class="setting-row"><span>静音时段</span><span><input id="quietStart" type="time" value="${s.quietStart}"> - <input id="quietEnd" type="time" value="${s.quietEnd}"></span></div></div>
 <div class="settings-card"><h3>数据</h3><div class="setting-row"><span>导出 JSON / Excel 可读 CSV / 文本</span><span><button data-export="json">JSON</button> <button data-export="csv">CSV</button> <button data-export="txt">文本</button></span></div><div class="setting-row"><span>导入备份</span><input id="importFile" type="file" accept=".json"></div><div class="setting-row"><span>清空已完成</span><button id="clearCompleted" class="danger">清空</button></div></div>
 <div class="settings-card"><h3>同步与协作</h3><p class="count">当前版本使用浏览器本地存储，支持导入导出。接入账号后端后，可启用实时云同步、共享清单和冲突合并。</p></div>`;
 $("#setTheme").value=s.theme;$("#setTheme").onchange=async e=>{s.theme=e.target.value;applyTheme();await save(false)};$("#setFont").oninput=async e=>{s.fontSize=+e.target.value;applyTheme();await save(false)};
 $$("[data-setting]").forEach(x=>x.onclick=async()=>{const k=x.dataset.setting;s[k]=!s[k];await save(false);renderSettings()});
 $("#quietStart").onchange=async e=>{s.quietStart=e.target.value;await save(false)};$("#quietEnd").onchange=async e=>{s.quietEnd=e.target.value;await save(false)};
 $$("[data-export]").forEach(x=>x.onclick=()=>exportData(x.dataset.export));$("#importFile").onchange=importData;
 $("#clearCompleted").onclick=async()=>{const gone=data.tasks.filter(t=>t.completed);data.trash.unshift(...gone.map(t=>({...t,deletedAt:Date.now()})));data.tasks=data.tasks.filter(t=>!t.completed);await save();renderSettings();toast("已清空已完成任务")}
}
function toggleRow(label,key,on){return `<div class="setting-row"><span>${label}</span><button class="switch ${on?"on":""}" data-setting="${key}"><i></i></button></div>`}
function exportData(type){
 let content,name,mime;
 if(type==="json"){content=JSON.stringify(data,null,2);name="focustodo-backup.json";mime="application/json"}
 if(type==="csv"){content="\ufeff标题,备注,清单,优先级,截止时间,状态,标签\n"+data.tasks.map(t=>[t.title,t.notes,listById(t.listId).name,t.priority,t.dueAt||"",t.completed?"完成":"未完成",(t.tags||[]).join("|")].map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");name="focustodo-tasks.csv";mime="text/csv"}
 if(type==="txt"){content=data.tasks.map(t=>`${t.completed?"[x]":"[ ]"} ${t.title}${t.dueAt?` (${fmtDate(t.dueAt)})`:""}`).join("\n");name="focustodo-tasks.txt";mime="text/plain"}
 const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([content],{type:mime}));a.download=name;a.click();URL.revokeObjectURL(a.href)
}
function importData(e){const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=async()=>{try{const d=JSON.parse(r.result);if(!Array.isArray(d.tasks))throw 0;data={...DEFAULT_DATA,...d,settings:{...DEFAULT_DATA.settings,...d.settings}};await save();render();toast("备份导入成功")}catch{toast("备份文件格式无效")}};r.readAsText(f)}
function openTools(){
 modal(`<h2>工具箱</h2><div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap"><button id="toolCurrent">🌐 当前网页转待办</button><button id="toolCal">▦ 打开日历</button><button id="toolStats">📊 查看统计</button><button id="toolClear">清空搜索</button></div>`);
 $("#toolCurrent").onclick=async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});closeModal();if(!tab?.url){toast("桌面版无法直接读取浏览器当前网页，请把链接粘贴到任务附件");return}const now=Date.now();data.tasks.unshift({id:uid(),title:tab.title||"网页待办",notes:`来源：${tab.url}`,url:tab.url,listId:data.settings.defaultList,tags:["网页"],priority:data.settings.defaultPriority,completed:false,archived:false,createdAt:now,updatedAt:now,dueAt:null,reminders:[],repeat:null,subtasks:[],attachments:[{type:"link",url:tab.url}],order:now});await save();toast("网页已转为待办")};
 $("#toolCal").onclick=()=>{closeModal();state.view="calendar";render()};$("#toolStats").onclick=()=>{closeModal();state.view="stats";render()};$("#toolClear").onclick=()=>{state.search="";closeModal();render()}
}
function openPomodoro(t){
 let seconds=25*60,running=false,timer;
 modal(`<h2>🍅 专注：${esc(t.title)}</h2><div id="timer" style="font-size:54px;text-align:center;padding:24px">25:00</div><div class="modal-actions" style="justify-content:center"><button id="timerReset">重置</button><button class="save" id="timerStart">开始</button></div>`);
 const draw=()=>{$("#timer").textContent=`${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`};$("#timerStart").onclick=()=>{running=!running;$("#timerStart").textContent=running?"暂停":"继续";clearInterval(timer);if(running)timer=setInterval(()=>{seconds--;draw();if(seconds<=0){clearInterval(timer);chrome.runtime.sendMessage({type:"NOTIFY",title:"专注完成",message:t.title,taskId:t.id});toast("本次专注完成")}},1000)};$("#timerReset").onclick=()=>{clearInterval(timer);running=false;seconds=25*60;draw()}
}
function checkIncoming(){const p=new URLSearchParams(location.search);if(p.get("new")==="1")setTimeout(()=>$("#quickInput").focus(),100)}
load();
