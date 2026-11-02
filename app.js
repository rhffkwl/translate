'use strict';
(function () {
  const API_URL = 'https://api.x.ai/v1/chat/completions';
  const DEFAULT_MODEL = 'grok-4.20-0309-non-reasoning';
  const HISTORY_MAX = 30;
  const CTX_TURNS = 5;
  const K = { key: 'tr_api_key', model: 'tr_model', ctx: 'tr_context', useHist: 'tr_use_hist_ctx',
    hist: 'tr_history', tone: 'tr_tone', src: 'tr_src', tgt: 'tr_tgt', gender: 'tr_gender', foreign: 'tr_last_foreign' };
  const LANG_NAME = { ko: '한국어', en: 'English', th: 'ไทย' };
  const LANG_EN = { ko: 'Korean', en: 'English', th: 'Thai' };

  const $ = (id) => document.getElementById(id);
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  // ---------- views ----------
  function hasKey() { return !!ls.get(K.key, '').trim(); }
  function showMain() { $('mainView').hidden = false; $('settingsView').hidden = true; $('btnSettings').hidden = false; }
  function showSettings(setup) {
    $('mainView').hidden = true; $('settingsView').hidden = false;
    $('setupMsg').hidden = !setup;
    $('settingsTitle').textContent = setup ? '처음 설정' : '설정';
    $('btnCloseSettings').hidden = setup;
    $('btnDeleteKey').hidden = !hasKey();
    $('btnSettings').hidden = setup;
    $('apiKey').value = ls.get(K.key, '');
    $('apiKey').type = 'password'; $('btnToggleKey').textContent = '보기';
    $('modelName').value = ls.get(K.model, DEFAULT_MODEL);
    $('gender').value = ls.get(K.gender, 'm');
    $('settingsMsg').textContent = '';
  }
  function route() { if (hasKey()) showMain(); else showSettings(true); }

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 1600);
  }

  // ---------- language detection (script based; reliable for ko/th/en) ----------
  function detectLang(text) {
    let ko = 0, th = 0, lat = 0;
    for (const ch of text) {
      const c = ch.codePointAt(0);
      if ((c >= 0xAC00 && c <= 0xD7A3) || (c >= 0x1100 && c <= 0x11FF) || (c >= 0x3130 && c <= 0x318F)) ko++;
      else if (c >= 0x0E00 && c <= 0x0E7F) th++;
      else if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) lat++;
    }
    if (ko === 0 && th === 0 && lat === 0) return null;
    // Thai 555 / Korean ㅋㅋ alone still count via ranges above; latin weighted lower (mixed loanwords)
    if (th >= ko && th >= lat * 0.5) return 'th';
    if (ko >= th && ko >= lat * 0.5) return 'ko';
    return 'en';
  }

  function resolveLangs(text) {
    const srcSel = $('srcLang').value;
    let tgt = $('tgtLang').value;
    let src = srcSel === 'auto' ? detectLang(text) : srcSel;
    let autoFlipped = false;
    if (src && src === tgt) {
      // e.g. target Thai, but friend's Thai message pasted -> translate into Korean
      tgt = src !== 'ko' ? 'ko' : ls.get(K.foreign, 'en');
      if (tgt === src) tgt = 'en';
      autoFlipped = true;
    }
    return { src, tgt, srcSel, autoFlipped };
  }

  function updateDetected() {
    const text = $('srcText').value.trim();
    if ($('srcLang').value !== 'auto' || !text) { $('detected').textContent = ''; return; }
    const r = resolveLangs(text);
    $('detected').textContent = r.src ? `감지: ${LANG_NAME[r.src]} → ${LANG_NAME[r.tgt]}${r.autoFlipped ? ' (자동 전환)' : ''}` : '';
  }

  // ---------- history ----------
  function getHistory() { try { return JSON.parse(ls.get(K.hist, '[]')) || []; } catch (e) { return []; } }
  function saveHistory(h) { ls.set(K.hist, JSON.stringify(h.slice(0, HISTORY_MAX))); }
  function addHistory(item) {
    const h = getHistory().filter((x) => !(x.src === item.src && x.tgtLang === item.tgtLang));
    h.unshift(item); saveHistory(h); renderHistory();
  }
  function renderHistory() {
    const h = getHistory(); const ul = $('historyList'); ul.innerHTML = '';
    $('historyEmpty').hidden = h.length > 0; $('btnClearHistory').hidden = h.length === 0;
    h.forEach((x, i) => {
      const li = document.createElement('li');
      const s = document.createElement('div'); s.className = 'src';
      s.textContent = `${LANG_NAME[x.srcLang] || '?'} → ${LANG_NAME[x.tgtLang] || '?'} · ${x.src}`;
      const t = document.createElement('div'); t.className = 'tgt'; t.textContent = x.translation;
      const d = document.createElement('button'); d.className = 'del'; d.textContent = '×'; d.setAttribute('aria-label', '삭제');
      d.addEventListener('click', (e) => { e.stopPropagation(); const hh = getHistory(); hh.splice(i, 1); saveHistory(hh); renderHistory(); });
      li.append(s, t, d);
      li.addEventListener('click', () => {
        $('srcText').value = x.src;
        if (x.tgtLang) $('tgtLang').value = x.tgtLang;
        showResult(x);
        updateDetected();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      ul.appendChild(li);
    });
  }

  // ---------- prompt ----------
  function buildMessages(text, src, tgt, tone) {
    const gender = ls.get(K.gender, 'm');
    const ctx = $('ctxText').value.trim();
    const toneRule = tone === 'polite'
      ? 'TONE: polite and respectful, but still natural (not stiff or robotic). Korean: use 존댓말 (-요/-습니다 as natural). Thai: use polite particles ' +
        (gender === 'f' ? 'ค่ะ/คะ (female speaker), ดิฉัน or ฉัน' : 'ครับ (male speaker), ผม') + '. English: polite, friendly.'
      : 'TONE: casual, like texting a close friend. Korean: 반말, natural chat style. Thai: casual chat style (นะ, อะ, จ้า etc. where natural; drop formal particles unless the source is polite). English: casual texting style, contractions OK.';
    const sys = [
      'You are an expert conversational translator for chatting with friends (Korean, English, Thai).',
      `Translate the user's message from ${src ? LANG_EN[src] : 'the detected language'} into ${LANG_EN[tgt]}.`,
      'Goals: sound like a native speaker texting. Preserve meaning, tone, emotion, humor, emoji, punctuation style and line breaks.',
      'Convert slang and abbreviations to natural equivalents in the target language instead of literal translation:',
      '- Korean ㅋㅋ/ㅎㅎ ↔ Thai 555 ↔ English lol/haha; ㅠㅠ/ㅜㅜ ↔ Thai TT or ㅠㅠ-equivalent like "แง" ↔ English 😭/aww; ㅇㅇ ↔ yeah/yep ↔ อือ/อืม; ㄱㄱ ↔ let\'s go ↔ ไปกัน.',
      '- Thai particles ครับ/ค่ะ/คะ/นะ/จ้า/อะ/เนอะ carry politeness and mood; reflect that mood in the target language rather than translating them literally.',
      '- Keep names, places, numbers, URLs, and emoji unchanged.',
      toneRule,
      'Do NOT add explanations inside the translation. Do not answer questions in the message — only translate them.',
      'Respond ONLY with a JSON object, no markdown fences:',
      '{"translation": "<the translation>", "alternative": "<one other natural way to say it in the target language, or empty string if not useful>", "note": "<a SHORT note in Korean (1-2 sentences) explaining slang, nuance, cultural context or ambiguity in the source, or empty string if nothing worth explaining>"}',
      'Leave "note" empty for plain, unambiguous messages. Notes must always be written in Korean.',
    ];
    if (ctx) sys.push(`Conversation context provided by the user (use it to resolve ambiguity): ${ctx}`);
    if ($('useHistoryCtx').checked) {
      const recent = getHistory().slice(0, CTX_TURNS).reverse();
      if (recent.length) {
        sys.push('Recent messages in this chat (oldest first), for context only — do not translate these again:');
        recent.forEach((r) => sys.push(`- [${LANG_EN[r.srcLang] || '?'}] ${r.src.slice(0, 300)} => [${LANG_EN[r.tgtLang] || '?'}] ${r.translation.slice(0, 300)}`));
      }
    }
    return [ { role: 'system', content: sys.join('\n') }, { role: 'user', content: text } ];
  }

  function parseModelOutput(raw) {
    let s = (raw || '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      const o = JSON.parse(s);
      if (o && typeof o.translation === 'string') return o;
    } catch (e) {
      const m = s.match(/\{[\s\S]*\}/);
      if (m) { try { const o = JSON.parse(m[0]); if (o && typeof o.translation === 'string') return o; } catch (e2) {} }
    }
    return { translation: s, alternative: '', note: '' };
  }

  // ---------- API ----------
  async function callApi(messages) {
    const key = ls.get(K.key, '').trim();
    const model = ls.get(K.model, DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model, messages, temperature: 0.3, stream: false }),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('응답 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.');
      throw new Error('네트워크 오류예요. 인터넷 연결을 확인해 주세요.');
    }
    clearTimeout(timer);
    let body = null; let text = '';
    try { text = await res.text(); body = JSON.parse(text); } catch (e) {}
    if (!res.ok) {
      const msg = (body && (body.error && (body.error.message || body.error))) || (body && body.message) || '';
      const m = String(typeof msg === 'string' ? msg : JSON.stringify(msg));
      if (res.status === 401 || /api key|apikey|unauthor/i.test(m)) throw Object.assign(new Error('API 키가 올바르지 않아요. 설정에서 키를 확인해 주세요.'), { keyErr: true });
      if (res.status === 429) throw new Error('요청이 너무 많거나 사용 한도에 도달했어요. 잠시 후 다시 시도해 주세요.');
      if (res.status === 403) throw new Error('권한이 없거나 크레딧이 부족해요. console.x.ai 에서 결제/크레딧과 키 권한을 확인해 주세요.');
      if (res.status === 404 || /model/i.test(m)) throw new Error(`모델을 찾을 수 없어요 ("${model}"). 설정에서 모델 이름을 확인해 주세요.`);
      if (res.status >= 500) throw new Error(`xAI 서버 오류 (${res.status}). 잠시 후 다시 시도해 주세요.`);
      throw new Error(`요청 오류 (${res.status})${m ? ': ' + m.slice(0, 200) : ''}`);
    }
    const content = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
    if (!content) throw new Error('응답이 비어 있어요. 다시 시도해 주세요.');
    return content;
  }

  // ---------- translate ----------
  let busy = false;
  async function translate() {
    if (busy) return;
    const text = $('srcText').value.trim();
    if (!text) { $('srcText').focus(); return; }
    if (!hasKey()) { showSettings(true); return; }
    const { src, tgt } = resolveLangs(text);
    const tone = document.querySelector('input[name=tone]:checked').value;
    busy = true; const btn = $('btnTranslate');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>번역 중…';
    $('errorBox').hidden = true;
    try {
      const raw = await callApi(buildMessages(text, src, tgt, tone));
      const o = parseModelOutput(raw);
      const item = {
        src: text, srcLang: src || 'auto', tgtLang: tgt,
        translation: (o.translation || '').trim(),
        alternative: (o.alternative || '').trim(),
        note: (o.note || '').trim(), tone, t: Date.now(),
      };
      if (item.alternative === item.translation) item.alternative = '';
      if (tgt !== 'ko') ls.set(K.foreign, tgt);
      showResult(item);
      addHistory(item);
    } catch (e) {
      const eb = $('errorBox'); eb.textContent = '⚠️ ' + e.message; eb.hidden = false;
      if (e.keyErr) {
        const a = document.createElement('button'); a.className = 'ghost small-btn'; a.textContent = '설정 열기'; a.style.marginLeft = '8px';
        a.addEventListener('click', () => showSettings(false)); eb.appendChild(a);
      }
    } finally {
      busy = false; btn.disabled = false; btn.innerHTML = '번역하기 <span class="kbd">Ctrl/⌘+Enter</span>';
    }
  }

  function showResult(x) {
    $('resultCard').hidden = false;
    $('resultLang').textContent = `${LANG_NAME[x.srcLang] || '자동'} → ${LANG_NAME[x.tgtLang]}${x.tone === 'polite' ? ' · 정중하게' : ' · 친구처럼'}`;
    $('resultText').textContent = x.translation;
    $('altBox').hidden = !x.alternative; $('altText').textContent = x.alternative || '';
    $('noteBox').hidden = !x.note; $('noteText').textContent = x.note || '';
  }

  async function copyText(s) {
    if (!s) return;
    try { await navigator.clipboard.writeText(s); toast('복사했어요'); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = s; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, s.length);
      try { document.execCommand('copy'); toast('복사했어요'); } catch (e2) { toast('복사 실패'); }
      ta.remove();
    }
  }

  // ---------- init ----------
  function init() {
    $('defaultModelLabel').textContent = DEFAULT_MODEL;
    $('srcLang').value = ls.get(K.src, 'auto');
    $('tgtLang').value = ls.get(K.tgt, 'th');
    const tone = ls.get(K.tone, 'casual');
    document.querySelectorAll('input[name=tone]').forEach((r) => { r.checked = r.value === tone; r.addEventListener('change', () => ls.set(K.tone, r.value)); });
    $('ctxText').value = ls.get(K.ctx, '');
    $('ctxPreview').textContent = $('ctxText').value ? '· ' + $('ctxText').value.slice(0, 20) : '';
    $('useHistoryCtx').checked = ls.get(K.useHist, '1') === '1';

    $('srcLang').addEventListener('change', () => { ls.set(K.src, $('srcLang').value); updateDetected(); });
    $('tgtLang').addEventListener('change', () => { ls.set(K.tgt, $('tgtLang').value); updateDetected(); });
    $('btnSwap').addEventListener('click', () => {
      const text = $('srcText').value.trim();
      let s = $('srcLang').value; const t = $('tgtLang').value;
      if (s === 'auto') s = (text && detectLang(text)) || (t === 'ko' ? ls.get(K.foreign, 'en') : 'ko');
      if (s === t) s = t === 'ko' ? ls.get(K.foreign, 'en') : 'ko';
      $('srcLang').value = t; $('tgtLang').value = s;
      const res = $('resultText').textContent;
      if (!$('resultCard').hidden && res) { $('srcText').value = res; $('resultCard').hidden = true; }
      ls.set(K.src, $('srcLang').value); ls.set(K.tgt, $('tgtLang').value); updateDetected();
    });
    $('srcText').addEventListener('input', updateDetected);
    $('srcText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); translate(); } });
    $('btnTranslate').addEventListener('click', translate);
    $('btnClearSrc').addEventListener('click', () => { $('srcText').value = ''; $('resultCard').hidden = true; $('errorBox').hidden = true; updateDetected(); $('srcText').focus(); });
    $('btnPaste').addEventListener('click', async () => {
      try { const t = await navigator.clipboard.readText(); if (t) { $('srcText').value = t; updateDetected(); } }
      catch (e) { toast('붙여넣기 권한이 없어요. 길게 눌러 붙여넣어 주세요.'); }
    });
    $('btnCopy').addEventListener('click', () => copyText($('resultText').textContent));
    $('btnCopyAlt').addEventListener('click', () => copyText($('altText').textContent));
    $('ctxText').addEventListener('input', () => { ls.set(K.ctx, $('ctxText').value); $('ctxPreview').textContent = $('ctxText').value ? '· ' + $('ctxText').value.slice(0, 20) : ''; });
    $('useHistoryCtx').addEventListener('change', () => ls.set(K.useHist, $('useHistoryCtx').checked ? '1' : '0'));
    $('btnClearHistory').addEventListener('click', () => { if (confirm('최근 번역 기록을 모두 삭제할까요?')) { saveHistory([]); renderHistory(); } });

    // settings
    $('btnSettings').addEventListener('click', () => showSettings(false));
    $('btnCloseSettings').addEventListener('click', () => { if (hasKey()) showMain(); });
    $('btnToggleKey').addEventListener('click', () => {
      const k = $('apiKey'); const show = k.type === 'password'; k.type = show ? 'text' : 'password';
      $('btnToggleKey').textContent = show ? '숨기기' : '보기';
    });
    $('btnSaveSettings').addEventListener('click', () => {
      const key = $('apiKey').value.trim();
      if (!key) { $('settingsMsg').textContent = 'API 키를 입력해 주세요.'; return; }
      ls.set(K.key, key);
      ls.set(K.model, $('modelName').value.trim() || DEFAULT_MODEL);
      ls.set(K.gender, $('gender').value);
      $('apiKey').value = ''; $('apiKey').type = 'password';
      toast('저장했어요'); showMain();
    });
    $('btnDeleteKey').addEventListener('click', () => {
      if (!confirm('이 기기에 저장된 API 키를 삭제할까요?')) return;
      ls.del(K.key); $('apiKey').value = ''; toast('키를 삭제했어요'); showSettings(true);
    });

    renderHistory(); route(); updateDetected();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
