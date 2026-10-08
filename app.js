'use strict';
/* VlaDaaKAnime — веб-версия для iPhone / iPad / компьютера.
   Каталог и описания — Shikimori (GraphQL), видео — встроенный плеер Kodik.
   Всё хранится в браузере (localStorage): история, списки, оценки, настройки. */
const VERSION = '1.0';
const SHIKI = 'https://shikimori.io';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- Хранилище ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem('vla_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('vla_' + k, JSON.stringify(v)); } catch {} },
};
const S = {
  get design() { return LS.get('design', 'apple'); }, set design(v) { LS.set('design', v); applyDesign(); },
  get nick() { return LS.get('nick', ''); }, set nick(v) { LS.set('nick', v); Rates.reset(); },
  history() { return LS.get('history', []); },
  pushHistory(a, ep) {
    const h = S.history().filter(x => x.id !== a.id);
    h.unshift({ id: a.id, title: a.title, poster: a.poster, kind: a.kind, year: a.year, episode: ep || null, ts: Date.now() });
    LS.set('history', h.slice(0, 60));
  },
  lists() { return LS.get('lists', {}); },
  setEntry(a, patch) {
    const l = S.lists(); const cur = l[a.id] || { id: a.id, title: a.title, poster: a.poster, kind: a.kind, year: a.year };
    Object.assign(cur, patch, { ts: Date.now() });
    if (!cur.status && !cur.score) delete l[a.id]; else l[a.id] = cur;
    LS.set('lists', l);
  },
};
function applyDesign() { document.body.className = S.design === 'apple' ? 'apple' : 'std'; document.querySelector('meta[name=theme-color]').content = S.design === 'apple' ? '#000000' : '#0A1030'; }

// ---------- Сеть ----------
const memo = new Map();
let gqlChain = Promise.resolve();
// Shikimori ограничивает частоту запросов — отправляем их по очереди
function gql(query, key, ttl = 10 * 60e3) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.p;
  const p = (gqlChain = gqlChain.catch(() => {}).then(async () => {
    for (let i = 0; i < 3; i++) {
      const r = await fetch(SHIKI + '/api/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
      if (r.status === 429) { await sleep(800 * (i + 1)); continue; }
      if (!r.ok) throw new Error('Shikimori: ошибка ' + r.status);
      const j = await r.json(); if (j.errors) throw new Error(j.errors[0].message);
      await sleep(220); return j.data;
    }
    throw new Error('Shikimori: слишком много запросов, попробуйте позже');
  }));
  memo.set(key, { t: Date.now(), p }); p.catch(() => memo.delete(key));
  return p;
}
const F = `id name russian english japanese score kind status episodes episodesAired duration airedOn { year date } releasedOn { year }
  poster { mainUrl originalUrl } genres { id russian }`;
const FD = F + ` description descriptionHtml studios { name } screenshots { originalUrl x332Url }
  related { relationText anime { ${F} } }`;
function args(o) { return Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${typeof v === 'string' && k !== 'order' ? JSON.stringify(v) : v}`).join(', '); }
async function list(o, key) { const d = await gql(`{ animes(${args({ limit: 24, ...o })}) { ${F} } }`, key || JSON.stringify(o)); return d.animes.map(norm); }
async function anime(id) { const d = await gql(`{ animes(ids: "${+id}", limit: 1) { ${FD} } }`, 'a' + id, 30 * 60e3); if (!d.animes[0]) throw new Error('Тайтл не найден'); return norm(d.animes[0]); }

const KIND = { tv: 'ТВ сериал', movie: 'Фильм', ova: 'OVA', ona: 'ONA', special: 'Спешл', tv_special: 'ТВ спешл', music: 'Клип', pv: 'Промо', cm: 'Реклама' };
const STATUS = { planned: 'Запланировано', watching: 'Смотрю', rewatching: 'Пересматриваю', completed: 'Просмотрено', on_hold: 'Отложено', dropped: 'Брошено' };
const SCORE_TXT = ['', 'Хуже некуда', 'Ужасно', 'Очень плохо', 'Плохо', 'Более-менее', 'Нормально', 'Хорошо', 'Отлично', 'Великолепно', 'Шедевр'];
function norm(a) {
  return {
    id: +a.id, title: a.russian || a.name, name: a.name, score: a.score > 0 ? a.score : null, kind: a.kind, status: a.status,
    episodes: a.episodes, aired: a.episodesAired, duration: a.duration, year: a.airedOn?.year, date: a.airedOn?.date,
    poster: a.poster?.mainUrl || a.poster?.originalUrl || null, posterBig: a.poster?.originalUrl || a.poster?.mainUrl,
    genres: (a.genres || []).map(g => g.russian), studios: (a.studios || []).map(s => s.name),
    desc: a.descriptionHtml ? htmlText(a.descriptionHtml) : (a.description || '').replace(/\[(\w+)=\d+ ([^\]]+)\]/g, '$2').replace(/\[\/?\w+(=[^\]]*)?\]/g, ''),
    shots: (a.screenshots || []).map(s => s.originalUrl), related: (a.related || []).filter(r => r.anime).map(r => ({ rel: r.relationText, a: norm(r.anime) })),
  };
}
function htmlText(h) { const d = new DOMParser().parseFromString(h.replace(/<br\s*\/?>/g, '\n'), 'text/html'); return (d.body.textContent || '').trim(); }

// Kodik: тот же публичный ключ, что использует их официальный скрипт встраивания
const Kodik = {
  token: null,
  async getToken() {
    if (this.token) return this.token;
    const js = await (await fetch('https://kodik-add.com/add-players.min.js')).text();
    this.token = (js.match(/token="([0-9a-f]{32})"/) || [])[1];
    if (!this.token) throw new Error('Не удалось получить ключ плеера Kodik');
    return this.token;
  },
  async link(id) {
    const r = await (await fetch(`https://kodik-api.com/get-player?token=${await this.getToken()}&shikimoriID=${id}`)).json();
    if (!r.found || !r.link) return null;
    return { url: (r.link.startsWith('//') ? 'https:' : '') + r.link, translation: r.translation, quality: r.quality };
  },
};

// Списки Shikimori по нику (только чтение — оценки ставятся в самом приложении на этом устройстве)
const Rates = {
  p: null,
  reset() { this.p = null; },
  all() {
    if (!S.nick) return Promise.resolve([]);
    return this.p ||= (async () => {
      const out = [];
      for (let page = 1; page <= 5; page++) {
        const r = await fetch(`${SHIKI}/api/users/${encodeURIComponent(S.nick)}/anime_rates?limit=1000&page=${page}`);
        if (r.status === 404) throw new Error('Пользователь Shikimori «' + S.nick + '» не найден');
        if (!r.ok) throw new Error('Shikimori: ошибка ' + r.status);
        const j = await r.json(); out.push(...j); if (j.length < 1000) break;
      }
      return out.filter(x => x.anime).map(x => ({
        status: x.status, score: x.score || null, watched: x.episodes,
        a: { id: x.anime.id, title: x.anime.russian || x.anime.name, kind: x.anime.kind, score: +x.anime.score || null, episodes: x.anime.episodes, aired: x.anime.episodes_aired,
          year: (x.anime.aired_on || '').slice(0, 4) || null, status: x.anime.status, poster: x.anime.image?.original ? SHIKI + x.anime.image.original : null },
      }));
    })().catch(e => { this.p = null; throw e; });
  },
  async map() { const m = {}; (await this.all().catch(() => [])).forEach(r => m[r.a.id] = r); return m; },
};
function myEntry(id, shikiMap) { const l = S.lists()[id]; const s = shikiMap?.[id]; return { status: l?.status || s?.status || null, score: l?.score || s?.score || null }; }

// ---------- Иконки ----------
const I = {
  home: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/>',
  star: '<path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="m15.5 15.5 5 5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  gear: '<path d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>',
};
const icon = n => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${I[n]}</svg>`;
const SECTIONS = [['home', 'Главная', 'home'], ['watching', 'Смотрю', 'play'], ['my', 'Моё', 'user'], ['new', 'Новинки', 'star'], ['catalog', 'Каталог', 'search'], ['settings', 'Настройки', 'gear']];

// ---------- Общие куски интерфейса ----------
function caption(a) {
  if (a.status === 'ongoing') return `${a.aired || 0}/${a.episodes || '?'} эп. · ${KIND[a.kind] || ''}`;
  return [a.year, KIND[a.kind]].filter(Boolean).join(' · ');
}
function card(a, o = {}) {
  const me = o.me ?? myEntry(a.id, o.shiki).score;
  return `<a class="card" href="#/anime/${a.id}" data-bg="${esc(a.poster || '')}">
    <div class="p">${a.poster ? `<img loading="lazy" decoding="async" src="${esc(a.poster)}" alt="">` : ''}
      ${a.score ? `<span class="badge">★ ${a.score.toFixed(1)}</span>` : ''}${me ? `<span class="badge me">★ ${me}</span>` : ''}
      ${o.progress != null ? `<div class="bar"><i style="width:${Math.round(o.progress * 100)}%"></i></div>` : ''}</div>
    <div class="t">${esc(a.title)}</div><div class="c">${esc(o.caption ?? caption(a))}</div></a>`;
}
const skeleton = n => Array.from({ length: n }, () => '<div class="card skel"><div class="p"></div><div class="t">&nbsp;</div></div>').join('');
function shelf(title, id) { return `<h2>${esc(title)}</h2><div class="shelf" id="${id}">${skeleton(8)}</div>`; }
async function fill(id, promise, map = a => card(a), empty = 'Пусто') {
  const el = document.getElementById(id); if (!el) return;
  try { const items = await promise; if (!document.body.contains(el)) return; el.innerHTML = items.length ? items.map(map).join('') : `<div class="empty">${empty}</div>`; }
  catch (e) { el.innerHTML = `<div class="empty err">${esc(e.message)} <button class="btn sm" onclick="render()">Повторить</button></div>`; }
}
function season(d = new Date()) {
  const m = d.getMonth(), y = d.getFullYear();
  const [k, t] = m <= 1 || m === 11 ? ['winter', 'Зима'] : m <= 4 ? ['spring', 'Весна'] : m <= 7 ? ['summer', 'Лето'] : ['fall', 'Осень'];
  const yy = m === 11 ? y + 1 : y;
  return { key: `${k}_${yy}`, title: `${t} ${yy}` };
}

// ---------- Экраны ----------
const V = {};
V.home = async (el) => {
  const s = season();
  const hist = S.history();
  el.classList.add('hero-page');
  el.innerHTML = `<section class="hero" id="hero"><div class="info"><div class="kicker">Сейчас выходит</div><h1>&nbsp;</h1></div></section>
    ${hist.length ? `<h2>Продолжить просмотр</h2><div class="shelf">${hist.slice(0, 20).map(h => card(h, { caption: h.episode ? `Серия ${h.episode}` : 'Открыт плеер' })).join('')}</div>` : ''}
    <div id="stats"></div>
    ${shelf('Сейчас выходят', 'sh1')}${shelf('Сезон: ' + s.title, 'sh2')}${shelf('Лучшие за всё время', 'sh3')}${shelf('Фильмы', 'sh4')}`;
  const ongoing = list({ status: 'ongoing', order: 'ranked', kind: '!special,!music,!pv,!cm' }, 'ongoing');
  ongoing.then(l => hero(l.find(a => a.score) || l[0])).catch(() => {});
  stats();
  fill('sh1', ongoing);
  fill('sh2', list({ season: s.key, order: 'popularity', kind: '!special,!music,!pv,!cm' }, 'season'));
  fill('sh3', list({ order: 'ranked', kind: 'tv' }, 'top'));
  fill('sh4', list({ order: 'ranked', kind: 'movie' }, 'movies'));
};
async function hero(a0) {
  const el = $('#hero'); if (!el || !a0) return;
  let a = a0; try { a = await anime(a0.id); } catch {}
  if (!document.body.contains(el)) return;
  const art = a.shots[0] || a.posterBig;
  el.innerHTML = `${art ? `<img class="art" src="${esc(art)}" alt="">` : ''}<div class="info">
    <div class="kicker">Сейчас выходит · №1 по рейтингу</div><h1>${esc(a.title)}</h1>
    <div class="meta">${[a.score && '★ ' + a.score.toFixed(1), a.year, KIND[a.kind], a.episodes && a.episodes + ' эп.'].filter(Boolean).map(esc).join('<span>|</span>')}</div>
    ${a.desc ? `<p class="desc">${esc(a.desc)}</p>` : ''}
    <div class="btns"><a class="btn primary" href="#/watch/${a.id}">▶ Смотреть</a><a class="btn" href="#/anime/${a.id}">Подробнее</a></div></div>`;
}
async function stats() {
  const el = $('#stats'); if (!el) return;
  if (!S.nick) { el.innerHTML = `<div class="box"><h3>Ваша статистика</h3><p class="hint">Укажите ник Shikimori в <a href="#/settings"><b>Настройках</b></a> — здесь появится, сколько времени потрачено на аниме, серии и списки.</p></div>`; return; }
  try {
    const r = await Rates.all(); if (!document.body.contains(el)) return;
    let eps = 0, min = 0; const by = {}; const scores = [];
    r.forEach(x => { by[x.status] = (by[x.status] || 0) + 1; eps += x.watched || 0; min += (x.watched || 0) * 24; if (x.score) scores.push(x.score); });
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';
    el.innerHTML = `<div class="box"><h3>Ваша статистика · ${esc(S.nick)}</h3><div class="statgrid">
      <div class="stat"><b>${Math.round(min / 60 / 24)} дн.</b><span>потрачено на аниме (≈)</span></div>
      <div class="stat"><b>${eps}</b><span>серий просмотрено</span></div>
      <div class="stat"><b>${by.completed || 0}</b><span>просмотрено</span></div>
      <div class="stat"><b>${by.watching || 0}</b><span>смотрю</span></div>
      <div class="stat"><b>★ ${avg}</b><span>моя средняя · оценено ${scores.length}</span></div></div></div>`;
  } catch (e) { el.innerHTML = `<div class="box"><p class="hint err">${esc(e.message)}</p></div>`; }
}

V.watching = async (el) => {
  const hist = S.history();
  const local = Object.values(S.lists()).filter(x => x.status === 'watching' || x.status === 'rewatching');
  el.innerHTML = `<div class="pad"><h1>Смотрю</h1><p class="sub">История на этом устройстве и список «Смотрю»</p></div>
    <h2>История</h2>${hist.length ? `<div class="grid">${hist.map(h => card(h, { caption: h.episode ? `Серия ${h.episode}` : new Date(h.ts).toLocaleDateString('ru') })).join('')}</div>` : '<div class="empty">Пока пусто — начните смотреть что-нибудь из Каталога</div>'}
    ${local.length ? `<h2>Мой список «Смотрю»</h2><div class="grid">${local.map(x => card(x, { me: x.score })).join('')}</div>` : ''}
    ${S.nick ? `<h2>Смотрю на Shikimori</h2><div class="grid" id="sw">${skeleton(6)}</div>` : ''}`;
  if (S.nick) fill('sw', Rates.all().then(r => r.filter(x => x.status === 'watching' || x.status === 'rewatching')),
    x => card(x.a, { me: x.score, caption: `${x.watched}/${x.a.episodes || '?'} эп.`, progress: x.a.episodes ? x.watched / x.a.episodes : null }), 'Список пуст');
};

let myStatus = 'watching';
V.my = async (el) => {
  const draw = async () => {
    el.innerHTML = `<div class="pad"><h1>Моё</h1><p class="sub">${S.nick ? 'Списки Shikimori «' + esc(S.nick) + '» и отметки на этом устройстве' : 'Отметки на этом устройстве. Ник Shikimori можно указать в Настройках'}</p></div>
      <div class="chips">${Object.entries(STATUS).map(([k, t]) => `<button class="chip ${k === myStatus ? 'on' : ''}" data-s="${k}">${t}</button>`).join('')}
      <button class="chip ${myStatus === 'scored' ? 'on' : ''}" data-s="scored">★ С оценкой</button></div>
      <div class="grid" id="ml">${skeleton(9)}</div>`;
    el.querySelectorAll('.chip').forEach(b => b.onclick = () => { myStatus = b.dataset.s; draw(); });
    const shiki = await Rates.all().catch(e => { toast(e.message); return []; });
    const seen = new Set(); const out = [];
    Object.values(S.lists()).forEach(x => { if (myStatus === 'scored' ? x.score : x.status === myStatus) { seen.add(x.id); out.push({ a: x, score: x.score }); } });
    shiki.forEach(x => { if (seen.has(x.a.id) || S.lists()[x.a.id]?.status) return; if (myStatus === 'scored' ? x.score : x.status === myStatus) out.push({ a: x.a, score: x.score, w: x.watched }); });
    fill('ml', Promise.resolve(out), x => card(x.a, { me: x.score, caption: x.w != null ? `${x.w}/${x.a.episodes || '?'} эп.` : caption(x.a) }), 'В этом списке пока ничего нет');
  };
  draw();
};

V.new = async (el) => {
  el.innerHTML = `<div class="pad"><h1>Новинки</h1><p class="sub">Недавно стартовавшие онгоинги и самые ожидаемые анонсы</p></div>
    <h2>Недавно начались</h2><div class="grid" id="n1">${skeleton(12)}</div><h2>Скоро выйдут</h2><div class="grid" id="n2">${skeleton(12)}</div>`;
  fill('n1', list({ status: 'ongoing', order: 'aired_on', limit: 30, kind: '!special,!music,!pv,!cm' }, 'new1'));
  fill('n2', list({ status: 'anons', order: 'popularity', limit: 30, kind: '!special,!music,!pv,!cm' }, 'new2'));
};

const Cat = { q: '', kind: '', order: 'ranked', genre: '', page: 1 };
V.catalog = async (el) => {
  const kinds = [['', 'Все'], ['tv', 'Сериалы'], ['movie', 'Фильмы'], ['ova,ona', 'OVA / ONA']];
  const orders = [['ranked', 'По рейтингу'], ['popularity', 'Популярные'], ['aired_on', 'Новые']];
  el.innerHTML = `<div class="pad"><h1>Каталог</h1><input class="field" id="q" type="search" enterkeyhint="search" placeholder="Поиск по названию" value="${esc(Cat.q)}" autocomplete="off"></div>
    <div class="chips" id="ck">${kinds.map(([k, t]) => `<button class="chip ${Cat.kind === k ? 'on' : ''}" data-k="${k}">${t}</button>`).join('')}<span style="width:10px"></span>
    ${orders.map(([k, t]) => `<button class="chip ${Cat.order === k ? 'on' : ''}" data-o="${k}">${t}</button>`).join('')}</div>
    <div class="chips" id="cg"></div><div class="grid" id="cl">${skeleton(12)}</div>
    <div class="pad" style="text-align:center;margin:20px 0"><button class="btn" id="more">Показать ещё</button></div>`;
  const load = async (append) => {
    const box = $('#cl'); if (!append) { Cat.page = 1; box.innerHTML = skeleton(12); }
    const o = { limit: 30, page: Cat.page, kind: Cat.kind || '!special,!music,!pv,!cm', genre: Cat.genre || null };
    if (Cat.q.trim()) o.search = Cat.q.trim(); else o.order = Cat.order;
    try {
      const l = await list(o); if (!document.body.contains(box)) return;
      const html = l.map(a => card(a)).join('');
      if (append) box.insertAdjacentHTML('beforeend', html); else box.innerHTML = html || '<div class="empty">Ничего не найдено</div>';
      $('#more').style.display = l.length < 30 ? 'none' : '';
    } catch (e) { box.innerHTML = `<div class="empty err">${esc(e.message)}</div>`; }
  };
  let t; $('#q').oninput = e => { Cat.q = e.target.value; clearTimeout(t); t = setTimeout(() => load(false), 450); };
  $('#q').onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
  el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { Cat.kind = b.dataset.k; el.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('on', x === b)); load(false); });
  el.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { Cat.order = b.dataset.o; el.querySelectorAll('[data-o]').forEach(x => x.classList.toggle('on', x === b)); load(false); });
  $('#more').onclick = () => { Cat.page++; load(true); };
  load(false);
  gql('{ genres(entryType: Anime) { id russian kind } }', 'genres', 864e5).then(d => {
    const g = d.genres.filter(x => x.kind === 'genre' || x.kind === 'theme' || x.kind === 'demographic').sort((a, b) => a.russian.localeCompare(b.russian, 'ru'));
    const cg = $('#cg'); if (!cg) return;
    cg.innerHTML = `<button class="chip ${!Cat.genre ? 'on' : ''}" data-g="">Все жанры</button>` + g.map(x => `<button class="chip ${Cat.genre === x.id ? 'on' : ''}" data-g="${x.id}">${esc(x.russian)}</button>`).join('');
    cg.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { Cat.genre = b.dataset.g; cg.querySelectorAll('[data-g]').forEach(x => x.classList.toggle('on', x === b)); load(false); });
  }).catch(() => {});
};

V.anime = async (el, id) => {
  el.classList.add('hero-page');
  el.innerHTML = `<a class="back" href="javascript:history.back()" aria-label="Назад">‹</a><div class="empty" style="padding-top:140px">Загрузка…</div>`;
  let a; try { a = await anime(id); } catch (e) { el.innerHTML = `<a class="back" href="javascript:history.back()">‹</a><div class="empty err" style="padding-top:140px">${esc(e.message)}</div>`; return; }
  const shiki = await Rates.map();
  const me = myEntry(a.id, shiki);
  setBg(a.posterBig);
  const ep = a.status === 'ongoing' ? `${a.aired || 0} из ${a.episodes || '?'} эп.` : a.episodes ? `${a.episodes} эп.` : null;
  const st = { anons: 'Анонс', ongoing: 'Выходит', released: 'Вышло' }[a.status];
  el.innerHTML = `<a class="back" href="javascript:history.back()" aria-label="Назад">‹</a>
    <section class="dhead">${a.shots[0] ? `<img class="art" src="${esc(a.shots[0])}" alt="">` : ''}<div class="in">
      ${a.poster ? `<img class="poster" src="${esc(a.posterBig)}" alt="">` : ''}
      <div><h1>${esc(a.title)}</h1><div class="orig">${esc(a.name)}</div>
      <div class="meta" style="margin-top:8px">${[a.score && '★ ' + a.score.toFixed(1), st, KIND[a.kind], a.year, ep, a.duration && a.duration + ' мин.'].filter(Boolean).map(esc).join('<span>·</span>')}</div></div></div></section>
    <div class="pad"><div class="btns">
      ${a.status !== 'anons' ? `<a class="btn primary" href="#/watch/${a.id}">▶ Смотреть</a>` : ''}
      <button class="btn" id="bst">${me.status ? '✓ ' + STATUS[me.status] : '+ В список'}</button>
      <button class="btn" id="bsc">${me.score ? '★ Моя оценка: ' + me.score : '☆ Оценить'}</button></div>
      <div class="genres">${a.genres.map(g => `<span>${esc(g)}</span>`).join('')}</div>
      ${a.desc ? `<p class="hint" style="font-size:15px;color:var(--text);white-space:pre-line;margin-top:14px">${esc(a.desc)}</p>` : ''}
      ${a.studios.length ? `<p class="hint">Студия: ${esc(a.studios.join(', '))}</p>` : ''}</div>
    ${a.shots.length ? `<h2>Кадры</h2><div class="shots">${a.shots.slice(0, 12).map(s => `<img loading="lazy" src="${esc(s)}" alt="">`).join('')}</div>` : ''}
    ${a.related.length ? `<h2>Связанное</h2><div class="shelf">${a.related.map(r => card(r.a, { caption: r.rel, shiki })).join('')}</div>` : ''}`;
  $('#bst').onclick = () => pickStatus(a, me.status);
  $('#bsc').onclick = () => pickScore(a, me.score);
};

V.watch = async (el, id) => {
  el.innerHTML = `<a class="back" href="javascript:history.back()" aria-label="Назад">‹</a><div class="player" id="pl"><div class="empty">Загрузка плеера…</div></div>
    <div class="pad"><h1 id="wt" style="font-size:22px;margin-top:14px">&nbsp;</h1><p class="hint" id="wi"></p>
    <p class="hint">Озвучку и серию можно выбрать прямо в плеере. Полный экран — кнопка в углу плеера.</p></div>`;
  let a; try { a = await anime(id); } catch (e) { $('#pl').innerHTML = `<div class="empty err">${esc(e.message)}</div>`; return; }
  $('#wt').textContent = a.title; setBg(a.posterBig);
  const prev = S.history().find(h => h.id === a.id);
  S.pushHistory(a, prev?.episode);
  try {
    const k = await Kodik.link(a.id);
    if (!k) { $('#pl').innerHTML = '<div class="empty">Видео для этого тайтла пока не найдено</div>'; return; }
    const u = new URL(k.url); if (prev?.episode) { u.searchParams.set('episode', prev.episode); u.searchParams.set('season', prev.season || 1); }
    $('#pl').innerHTML = `<iframe src="${esc(u.href)}" allow="autoplay *; fullscreen *; picture-in-picture *" allowfullscreen referrerpolicy="origin"></iframe>`;
    $('#wi').textContent = [k.translation && 'Озвучка: ' + k.translation, k.quality, prev?.episode && 'Продолжаем с серии ' + prev.episode].filter(Boolean).join(' · ');
    curWatch = a;
  } catch (e) { $('#pl').innerHTML = `<div class="empty err">${esc(e.message)}</div>`; }
};
let curWatch = null;
// Плеер Kodik сообщает номер серии — запоминаем, чтобы продолжить с неё
window.addEventListener('message', e => {
  const d = e.data; if (!curWatch || !d || typeof d !== 'object') return;
  if (d.key === 'kodik_player_current_episode' && d.value?.episode) {
    const h = S.history(); const x = h.find(v => v.id === curWatch.id);
    if (x) { x.episode = d.value.episode; x.season = d.value.season; x.ts = Date.now(); LS.set('history', h); }
  }
});

V.settings = async (el) => {
  el.innerHTML = `<div class="pad"><h1>Настройки</h1></div>
    <div class="box"><h3>Дизайн интерфейса</h3><div class="row">
      <button class="chip ${S.design === 'std' ? 'on' : ''}" data-d="std">${S.design === 'std' ? '✓ ' : ''}Стандартный</button>
      <button class="chip ${S.design === 'apple' ? 'on' : ''}" data-d="apple">${S.design === 'apple' ? '✓ ' : ''}Apple TV</button></div>
      <p class="hint">${S.design === 'apple' ? 'Как в tvOS: чёрный фон, матовое стекло панелей, большая афиша, белые кнопки.' : 'VlaDaaKEdition — ночной неоновый город: тёмно-синий фон, лисий оранжевый и фиолетовый неон.'}</p></div>
    <div class="box"><h3>Аккаунт Shikimori</h3><p class="hint">Введите ник — подтянутся ваши списки («Смотрю», «Просмотрено»…), оценки и статистика. Это только чтение: отметки и оценки, поставленные здесь, хранятся в этом браузере.</p>
      <div class="row"><input class="field" id="nick" placeholder="Ник на Shikimori" value="${esc(S.nick)}" autocapitalize="off" autocorrect="off" style="flex:1;min-width:200px"><button class="btn primary" id="snick">Сохранить</button></div>
      <p class="hint" id="nickst"></p></div>
    <div class="box"><h3>Установить на iPhone</h3><p class="hint">Откройте этот сайт в <b>Safari</b> → кнопка «Поделиться» (квадрат со стрелкой) → <b>«На экран „Домой“»</b> → «Добавить». Появится значок VlaDaaKAnime, приложение откроется на весь экран.</p></div>
    <div class="box"><h3>Данные</h3><p class="hint">История: ${S.history().length} · отметок в списках: ${Object.keys(S.lists()).length}</p>
      <div class="row"><button class="btn sm" id="chist">Очистить историю</button><button class="btn sm" id="clist">Очистить отметки</button></div></div>
    <div class="box"><h3>О приложении</h3><p class="hint">VlaDaaKAnime для iPhone (веб-версия ${VERSION}). Каталог и описания — Shikimori, видео — плеер Kodik.<br>Приложение для Android TV и телефонов: <a href="https://github.com/Vla3Daak/VlaDaaK/releases" target="_blank" rel="noopener"><b>GitHub</b></a>.</p></div>`;
  el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { S.design = b.dataset.d; render(); });
  $('#snick').onclick = async () => {
    S.nick = $('#nick').value.trim(); $('#nickst').textContent = S.nick ? 'Проверяю…' : 'Ник удалён';
    if (!S.nick) return;
    try { const r = await Rates.all(); $('#nickst').textContent = `Готово: ${r.length} тайтлов в списках`; } catch (e) { $('#nickst').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
  $('#chist').onclick = () => { if (confirm('Очистить историю просмотра?')) { LS.set('history', []); render(); } };
  $('#clist').onclick = () => { if (confirm('Удалить все отметки и оценки на этом устройстве?')) { LS.set('lists', {}); render(); } };
};

// ---------- Окна выбора ----------
function sheet(html) {
  const s = $('#sheet'); s.innerHTML = `<div class="panel">${html}</div>`; s.hidden = false;
  s.onclick = e => { if (e.target === s) close(); };
  const close = () => { s.hidden = true; s.innerHTML = ''; };
  return { el: s, close };
}
function pickStatus(a, cur) {
  const sh = sheet(`<h3 style="margin:0">${esc(a.title)}</h3><p class="hint">Добавить в список</p><div class="row">
    ${Object.entries(STATUS).map(([k, t]) => `<button class="chip ${k === cur ? 'on' : ''}" data-s="${k}">${t}</button>`).join('')}</div>
    <div class="row" style="margin-top:14px">${cur ? '<button class="btn sm" data-s="">Убрать из списка</button>' : ''}<button class="btn sm" data-x>Закрыть</button></div>`);
  sh.el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { S.setEntry(a, { status: b.dataset.s || null }); sh.close(); render(); toast(b.dataset.s ? 'Добавлено: ' + STATUS[b.dataset.s] : 'Убрано из списка'); });
  sh.el.querySelector('[data-x]').onclick = sh.close;
}
function pickScore(a, cur) {
  let v = cur || 0;
  const sh = sheet(`<h3 style="margin:0">Моя оценка — ${esc(a.title)}</h3><p class="hint" id="stx">${v ? v + ' — ' + SCORE_TXT[v] : 'Выберите от 1 до 10'}</p>
    <div class="stars">${Array.from({ length: 10 }, (_, i) => `<button data-v="${i + 1}" class="${i + 1 <= v ? 'on' : ''}">${i + 1}</button>`).join('')}</div>
    <div class="row"><button class="btn primary" data-ok>Поставить</button>${cur ? '<button class="btn" data-r>Сбросить оценку</button>' : ''}<button class="btn" data-x>Закрыть</button></div>`);
  const upd = () => { sh.el.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('on', +b.dataset.v <= v)); $('#stx').textContent = v ? v + ' — ' + SCORE_TXT[v] : 'Выберите от 1 до 10'; };
  sh.el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { v = +b.dataset.v; upd(); });
  sh.el.querySelector('[data-ok]').onclick = () => { if (!v) return; S.setEntry(a, { score: v, status: S.lists()[a.id]?.status || 'completed' }); sh.close(); render(); toast('Оценка ★ ' + v); };
  sh.el.querySelector('[data-r]')?.addEventListener('click', () => { S.setEntry(a, { score: null }); sh.close(); render(); });
  sh.el.querySelector('[data-x]').onclick = sh.close;
}
function toast(t) {
  const d = document.createElement('div'); d.textContent = t;
  d.style.cssText = 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 96px);transform:translateX(-50%);z-index:50;background:rgba(30,30,30,.92);color:#fff;padding:10px 18px;border-radius:999px;font-size:14px;-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);transition:opacity .3s';
  document.body.appendChild(d); setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 300); }, 1800);
}

// ---------- Фон и навигация ----------
function setBg(url) { const b = $('#bg'); if (!url) { b.classList.remove('on'); return; } b.style.backgroundImage = `url("${url}")`; b.classList.add('on'); }
const scrolls = {};
let curKey = '';
async function render() {
  const [, sec = 'home', id] = (location.hash || '#/home').split('/');
  const key = location.hash || '#/home';
  const top = SECTIONS.find(s => s[0] === sec) ? sec : null;
  const nav = SECTIONS.map(([k, t, ic]) => `<a href="#/${k}" class="${k === (top || '') ? 'on' : ''}">${icon(ic)}<span>${t}</span></a>`).join('');
  $('#tabbar').innerHTML = nav;
  $('#topbar').innerHTML = `<img src="icon-192.png" alt="">` + SECTIONS.map(([k, t]) => `<a href="#/${k}" class="${k === (top || '') ? 'on' : ''}">${t}</a>`).join('');
  const old = $('#view'); const el = old.cloneNode(false); el.className = ''; old.replaceWith(el);
  if (sec !== 'anime' && sec !== 'watch') setBg(null);
  if (sec !== 'watch') curWatch = null;
  await (V[sec] || V.home)(el, id);
  if (key === curKey) return;
  curKey = key; window.scrollTo(0, scrolls[key] || 0);
}
window.render = render;
addEventListener('hashchange', () => { scrolls[curKey] = scrollY; render(); });
// Парящая панель прячется при прокрутке вниз и возвращается при прокрутке вверх (как в tvOS)
let lastY = 0; addEventListener('scroll', () => { const y = scrollY; $('#topbar').classList.toggle('hide', y > 120 && y > lastY); lastY = y; }, { passive: true });
// Фон под постер при наведении (компьютер)
document.addEventListener('mouseover', e => { const c = e.target.closest?.('.card'); if (c && c.dataset.bg && S.design === 'apple' && matchMedia('(hover:hover)').matches) setBg(c.dataset.bg); });

applyDesign();
render();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
