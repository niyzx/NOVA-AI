/* ==========================================================
   NOVA – Assistente Virtual
   ARQUIVO 3 de 3: script.js  (o "cérebro" do app)

   Índice:
   1. Configuração e estado
   2. Funções auxiliares
   3. Mensagens na tela
   4. Voz do assistente (SpeechSynthesis)
   5. Reconhecimento de voz (microfone)
   6. Comandos locais ("Que horas são?" etc.)
   7. sendToAI  <<< AQUI SERÁ CONECTADA A IA REAL
   8. Fluxo principal de envio
   9. Configurações e eventos
   10. Inicialização
   ========================================================== */
(() => {
  'use strict'; // modo estrito: ajuda a evitar erros bobos

  /* ========================================================
     1. CONFIGURAÇÃO E ESTADO
     ======================================================== */

  // Nomes das "gavetas" no localStorage (memória do navegador)
  const STORAGE = {
    settings: 'nova.settings.v1',
    history: 'nova.history.v1'
  };

  const MAX_HISTORY = 200;   // guarda no máximo 200 mensagens (poupa memória)
  const CONTEXT_SIZE = 12;   // quantas mensagens recentes enviar à IA como contexto

  // Configuração da IA. Por enquanto "useBackend" é false = respostas simuladas.
  // Quando você tiver um servidor (backend), troque para true e coloque a URL dele.
  // NUNCA coloque chave de API aqui: qualquer pessoa conseguiria vê-la.
  //
  // CONFIGURAÇÃO COM SUPABASE (preencha estes 2 campos e mude useBackend para true):
  //  - backendUrl: https://rpaxvwdlhrewwkhbyqoo.supabase.co/functions/v1/chat
  //  - supabaseAnonKey: a chave "anon public" (Project Settings > API Keys).
  //    Essa chave é PÚBLICA por natureza e pode ficar aqui. A chave da OpenAI
  //    NÃO fica aqui: ela fica nos Secrets do Supabase.
  const AI_CONFIG = {
    useBackend: true,
    backendUrl: 'https://rpaxvwdlhrewwkhbyqoo.supabase.co/functions/v1/chat',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwYXh2d2RsaHJld3draGJ5cW9vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0MjAyNzUsImV4cCI6MjEwNjk5NjI3NX0.XGHV2yE5dQ7y-L33jgOi9jdI_PBKo44Xh1SwpVnXM58',
    timeoutMs: 20000
  };

  // Configurações padrão do usuário
  const DEFAULT_SETTINGS = { userName: '', voiceOn: true, rate: 1 };

  // Estado do app (carregado do localStorage, se existir)
  let settings = Object.assign({}, DEFAULT_SETTINGS, load(STORAGE.settings, {}));
  let history = load(STORAGE.history, []);   // lista de { role, text, time }
  let busy = false;                          // true enquanto a NOVA está respondendo

  /* ========================================================
     2. FUNÇÕES AUXILIARES
     ======================================================== */

  // Atalho para pegar elementos da página pelo id
  const $ = (id) => document.getElementById(id);

  const els = {
    app: $('app'), avatar: $('avatar'), status: $('status'),
    chat: $('chat'), typing: $('typing'), chips: $('chips'),
    composer: $('composer'), input: $('input'), btnMic: $('btnMic'),
    btnVoice: $('btnVoice'), btnClear: $('btnClear'), btnSettings: $('btnSettings'),
    modal: $('settings'), setName: $('setName'), setVoice: $('setVoice'),
    setRate: $('setRate'), rateLabel: $('rateLabel'),
    btnWipe: $('btnWipe'), btnCloseSettings: $('btnCloseSettings')
  };

  // Lê do localStorage com segurança (se der erro, devolve o valor padrão)
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  // Salva no localStorage com segurança (modo privado pode bloquear)
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignora */ }
  }

  // Remove acentos e põe em minúsculas: "Que horas são?" -> "que horas sao?"
  function normalize(text) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  // Escolhe um item aleatório de uma lista
  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  // Pausa assíncrona (usada para simular "pensando")
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Formata data/hora da mensagem: hoje = "14:05"; outros dias = "07/10 14:05"
  function formatStamp(ts) {
    const d = new Date(ts);
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return hora;
    const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return dia + ' ' + hora;
  }

  /* ========================================================
     3. MENSAGENS NA TELA
     ======================================================== */

  // Cria o balão de uma mensagem e coloca no chat
  function renderMessage(msg) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (msg.role === 'user' ? 'user' : 'nova');

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = msg.text; // textContent (e não innerHTML) = seguro contra código malicioso

    const time = document.createElement('div');
    time.className = 'time';
    time.textContent = formatStamp(msg.time);

    wrap.append(bubble, time);
    els.chat.appendChild(wrap);
    els.chat.scrollTop = els.chat.scrollHeight; // rola até a última mensagem
  }

  // Adiciona mensagem ao histórico, salva e mostra na tela
  function addMessage(role, text) {
    const msg = { role, text, time: Date.now() };
    history.push(msg);
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
    save(STORAGE.history, history);
    renderMessage(msg);
    return msg;
  }

  // Mostra/esconde a animação "pensando"
  function setTyping(on) {
    els.typing.hidden = !on;
    els.status.textContent = on ? 'Pensando…' : 'Online';
    if (on) els.chat.scrollTop = els.chat.scrollHeight;
  }

  // Apaga a conversa (tela + memória)
  function clearChat() {
    stopSpeaking();
    history = [];
    save(STORAGE.history, history);
    els.chat.textContent = '';
  }

  /* ========================================================
     4. VOZ DO ASSISTENTE (SpeechSynthesis)
     ======================================================== */

  const canSpeak = 'speechSynthesis' in window;
  let ptVoice = null; // voz em português escolhida

  // As vozes do aparelho carregam de forma assíncrona; procuramos uma em pt-BR
  function loadVoices() {
    if (!canSpeak) return;
    const voices = speechSynthesis.getVoices();
    ptVoice =
      voices.find((v) => v.lang === 'pt-BR') ||
      voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('pt')) ||
      null;
  }

  function speak(text) {
    if (!canSpeak || !settings.voiceOn) return;
    speechSynthesis.cancel(); // interrompe fala anterior

    // Remove emojis para a voz não tentar "ler" os símbolos
    const clean = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
    if (!clean) return;

    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'pt-BR';
    if (ptVoice) u.voice = ptVoice;
    u.rate = Number(settings.rate) || 1;
    u.onstart = () => els.avatar.classList.add('speaking');
    u.onend = u.onerror = () => els.avatar.classList.remove('speaking');
    speechSynthesis.speak(u);
  }

  function stopSpeaking() {
    if (canSpeak) speechSynthesis.cancel();
    els.avatar.classList.remove('speaking');
  }

  /* ========================================================
     5. RECONHECIMENTO DE VOZ (microfone)
     ======================================================== */

  // Chrome/Android usa "webkitSpeechRecognition"
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;

  function setupRecognition() {
    if (!SpeechRecognition) {
      els.btnMic.disabled = true;
      els.btnMic.title = 'Seu navegador não suporta reconhecimento de voz';
      return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.interimResults = true;  // mostra o texto enquanto você fala
    recognition.continuous = false;     // para sozinho quando você termina a frase

    recognition.onstart = () => {
      listening = true;
      els.btnMic.classList.add('listening');
      els.status.textContent = 'Ouvindo…';
    };

    recognition.onresult = (event) => {
      let text = '';
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
        if (event.results[i].isFinal) isFinal = true;
      }
      els.input.value = text;
      autoGrow();
      if (isFinal) handleSend(); // terminou de falar: envia sozinho
    };

    recognition.onerror = (event) => {
      const msgs = {
        'not-allowed': 'Preciso de permissão para usar o microfone. Libere nas configurações do navegador.',
        'service-not-allowed': 'O microfone está bloqueado neste modo de abertura. Tente abrir o app por HTTPS ou localhost.',
        'no-speech': 'Não ouvi nada. Tente de novo.',
        'audio-capture': 'Não encontrei um microfone neste aparelho.',
        'network': 'O reconhecimento de voz precisa de internet.'
      };
      const m = msgs[event.error];
      if (m) addMessage('nova', m);
    };

    recognition.onend = () => {
      listening = false;
      els.btnMic.classList.remove('listening');
      if (!busy) els.status.textContent = 'Online';
    };
  }

  function toggleMic() {
    if (!recognition) return;
    if (listening) { recognition.stop(); return; }
    stopSpeaking(); // evita que o microfone capte a voz da própria NOVA
    try { recognition.start(); } catch (e) { /* já estava iniciando */ }
  }

  /* ========================================================
     6. COMANDOS LOCAIS
     Respostas que o app resolve sozinho, sem precisar de IA.
     Devolve o texto da resposta, ou null se não for um comando.
     ======================================================== */

  function runCommand(raw) {
    const t = normalize(raw);
    const name = settings.userName;

    // Horas
    if (/\b(que horas|hora(s)? (sao|e)|me diga as horas)\b/.test(t)) {
      const h = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return 'Agora são ' + h + '. 🕒';
    }

    // Data
    if (/\b(qual (e )?a data|que dia (e )?hoje|data de hoje|dia da semana)\b/.test(t)) {
      const d = new Date().toLocaleDateString('pt-BR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
      return 'Hoje é ' + d + '. 📅';
    }

    // Limpar conversa
    if (/\b(limpar|apagar|zerar) (a )?(conversa|chat|historico)\b/.test(t)) {
      clearChat();
      return 'Conversa limpa! Vamos recomeçar. ✨';
    }

    // Ajuda
    if (/^(me ajude|ajuda|ajudar|help|o que voce (sabe|pode) fazer)/.test(t)) {
      return (
        'Posso conversar com você por texto ou voz. Experimente:\n' +
        '• "Que horas são?"\n' +
        '• "Qual é a data?"\n' +
        '• "Quanto é 12 x 8?"\n' +
        '• "Conte uma piada"\n' +
        '• "Meu nome é ..."\n' +
        '• "Limpar conversa"'
      );
    }

    // Aprender o nome do usuário: "meu nome é Ana"
    const nm = raw.match(/meu nome (?:é|e)\s+([A-Za-zÀ-ÿ' ]{2,30})/i);
    if (nm) {
      settings.userName = nm[1].trim().replace(/\s+/g, ' ');
      save(STORAGE.settings, settings);
      els.setName.value = settings.userName;
      return 'Prazer, ' + settings.userName + '! Vou lembrar do seu nome. 😊';
    }

    // Conta simples: "quanto é 12 x 8"
    const math = t.match(/(?:quanto e|calcule|calcular)?\s*(-?\d+(?:[.,]\d+)?)\s*([+\-x*\/]|mais|menos|vezes|dividido por)\s*(-?\d+(?:[.,]\d+)?)\s*\??$/);
    if (math && /\d/.test(t) && (/^(quanto e|calcule|calcular)/.test(t) || /^[\d\s.,+\-x*\/]+$/.test(t))) {
      const a = parseFloat(math[1].replace(',', '.'));
      const b = parseFloat(math[3].replace(',', '.'));
      const op = math[2];
      let r;
      if (op === '+' || op === 'mais') r = a + b;
      else if (op === '-' || op === 'menos') r = a - b;
      else if (op === 'x' || op === '*' || op === 'vezes') r = a * b;
      else r = b === 0 ? null : a / b;
      if (r === null) return 'Não dá para dividir por zero. 🙃';
      return 'O resultado é ' + String(Math.round(r * 1e6) / 1e6).replace('.', ',') + '.';
    }

    // Piada
    if (/\bpiada\b/.test(t)) {
      return pick([
        'Por que o computador foi ao médico? Porque estava com um vírus! 🦠',
        'O que o zero disse para o oito? Belo cinto! 😄',
        'Por que o livro de matemática ficou triste? Porque tinha muitos problemas. 📘',
        'Qual é o animal mais antigo? A zebra, porque é em preto e branco! 🦓'
      ]);
    }

    // Saudações
    if (/^(oi|ola|opa|e ai|bom dia|boa tarde|boa noite|hey|hello)\b/.test(t)) {
      return pick([
        'Olá' + (name ? ', ' + name : '') + '! Como posso ajudar? 😊',
        'Oi' + (name ? ', ' + name : '') + '! No que posso ajudar hoje?'
      ]);
    }

    // Quem é você
    if (/\b(quem e voce|qual (e )?seu nome|como voce se chama)\b/.test(t)) {
      return 'Eu sou a NOVA, sua assistente virtual. Posso conversar, responder dúvidas simples e te ajudar no dia a dia.';
    }

    // Agradecimento
    if (/\b(obrigad[oa]|valeu|thanks)\b/.test(t)) {
      return pick(['De nada! 😊', 'Sempre que precisar!', 'Por nada' + (name ? ', ' + name : '') + '!']);
    }

    return null; // não é comando: vai para a IA
  }

  /* ========================================================
     7. sendToAI  <<<  PONTO DE CONEXÃO COM A IA REAL  >>>

     Esta é a ÚNICA função que você precisa mexer para ligar
     uma IA de verdade (GPT, Claude etc.).

     message             -> texto que o usuário acabou de enviar
     conversationHistory -> mensagens anteriores no formato
                            [{ role: 'user' | 'assistant', content: '...' }]

     Deve devolver (via Promise) o texto da resposta.

     REGRA DE SEGURANÇA: o navegador NUNCA fala direto com a API
     da IA, porque a chave ficaria visível para todo mundo.
     O caminho certo é:

        app (este código)  ->  SEU SERVIDOR (backend)  ->  API da IA
                                (guarda a chave em segredo)
     ======================================================== */
  async function sendToAI(message, conversationHistory) {
    if (AI_CONFIG.useBackend) {
      // ---------- MODO REAL: chama o SEU backend ----------
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AI_CONFIG.timeoutMs);
      try {
        const response = await fetch(AI_CONFIG.backendUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // O Supabase exige esta chave pública para aceitar a chamada à função
            'apikey': AI_CONFIG.supabaseAnonKey,
            'Authorization': 'Bearer ' + AI_CONFIG.supabaseAnonKey
          },
          body: JSON.stringify({
            message: message,
            history: conversationHistory,
            userName: settings.userName
          }),
          signal: controller.signal
        });
        if (!response.ok) throw new Error('Servidor respondeu ' + response.status);
        const data = await response.json();
        // O backend deve responder no formato: { "reply": "texto da resposta" }
        return data.reply || 'Não consegui gerar uma resposta agora.';
      } finally {
        clearTimeout(timer);
      }
    }

    // ---------- MODO SIMULADO (padrão): sem internet, sem API ----------
    await wait(600 + Math.random() * 700); // finge que está pensando
    return mockReply(message, conversationHistory);
  }

  // Respostas simuladas simples (apenas para o app funcionar sem IA)
  function mockReply(message) {
    const t = normalize(message);
    const name = settings.userName ? settings.userName : '';

    if (/\b(tudo bem|como voce esta|como vai)\b/.test(t)) {
      return 'Estou ótima, obrigada por perguntar! E você, como está?';
    }
    if (/\b(estou bem|to bem|tudo certo|tudo otimo)\b/.test(t)) {
      return 'Que bom! Em que posso ajudar?';
    }
    if (/\b(triste|cansad[oa]|ansios[oa]|estressad[oa])\b/.test(t)) {
      return 'Sinto muito que esteja assim' + (name ? ', ' + name : '') + '. Quer conversar sobre isso? Estou aqui para ouvir.';
    }
    if (/\b(tempo|clima|previsao)\b/.test(t)) {
      return 'Ainda não tenho acesso à previsão do tempo. Quando a IA for conectada ao servidor, poderei buscar isso.';
    }
    if (/\b(o que e|o que significa|explique|explica|como funciona)\b/.test(t)) {
      return 'Boa pergunta! No modo atual eu só dou respostas de exemplo. Com a IA conectada, eu explicaria isso de forma simples e direta.';
    }
    if (/\b(tchau|ate logo|ate mais|adeus)\b/.test(t)) {
      return 'Até logo' + (name ? ', ' + name : '') + '! Volte quando quiser. 👋';
    }
    return pick([
      'Entendi. Pode me dar mais detalhes?',
      'Interessante! Me conte um pouco mais.',
      'Ainda estou em modo de demonstração, mas anotei sua mensagem. Tente "Me ajude" para ver o que já sei fazer.',
      'Hmm, ainda não sei responder isso. Quando a IA for conectada, poderei ajudar melhor.'
    ]);
  }

  /* ========================================================
     8. FLUXO PRINCIPAL DE ENVIO
     ======================================================== */

  async function handleSend(textOverride) {
    const text = (typeof textOverride === 'string' ? textOverride : els.input.value).trim();
    if (!text || busy) return;

    busy = true;
    els.input.value = '';
    autoGrow();
    stopSpeaking();

    // Contexto recente para a IA (guardado ANTES de adicionar a mensagem atual)
    const context = history.slice(-CONTEXT_SIZE).map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text
    }));

    addMessage('user', text);

    let reply;
    const local = runCommand(text);

    if (local !== null) {
      // Comando simples: responde na hora
      setTyping(true);
      await wait(350);
      reply = local;
    } else {
      // Conversa normal: pergunta à IA (simulada ou real)
      setTyping(true);
      try {
        reply = await sendToAI(text, context);
      } catch (err) {
        reply = 'Ops, não consegui falar com o servidor agora. Tente novamente em instantes.';
      }
    }

    setTyping(false);
    addMessage('nova', reply);
    speak(reply);
    busy = false;
  }

  /* ========================================================
     9. CONFIGURAÇÕES E EVENTOS
     ======================================================== */

  // Cresce a caixa de texto conforme a pessoa digita (até um limite)
  function autoGrow() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 140) + 'px';
  }

  // Atualiza o botão de voz do topo (ligado/desligado)
  function refreshVoiceButton() {
    els.btnVoice.classList.toggle('muted', !settings.voiceOn);
    els.setVoice.checked = settings.voiceOn;
  }

  function saveSettings() {
    save(STORAGE.settings, settings);
    refreshVoiceButton();
  }

  function openSettings() {
    els.setName.value = settings.userName;
    els.setRate.value = settings.rate;
    els.rateLabel.textContent = Number(settings.rate).toFixed(1) + 'x';
    refreshVoiceButton();
    els.modal.hidden = false;
  }

  function closeSettings() {
    els.modal.hidden = true;
  }

  function bindEvents() {
    // Enviar (botão ou tecla Enter do teclado do formulário)
    els.composer.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSend();
    });

    // No computador, Enter envia e Shift+Enter quebra a linha.
    // No celular, Enter continua quebrando linha (o botão enviar resolve).
    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
        e.preventDefault();
        handleSend();
      }
    });
    els.input.addEventListener('input', autoGrow);

    // Microfone
    els.btnMic.addEventListener('click', toggleMic);

    // Atalhos rápidos
    els.chips.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) handleSend(chip.dataset.text);
    });

    // Botão de voz do topo
    els.btnVoice.addEventListener('click', () => {
      settings.voiceOn = !settings.voiceOn;
      if (!settings.voiceOn) stopSpeaking();
      saveSettings();
    });

    // Limpar conversa
    els.btnClear.addEventListener('click', () => {
      if (confirm('Limpar toda a conversa?')) {
        clearChat();
        addMessage('nova', 'Conversa limpa! Como posso ajudar?');
      }
    });

    // Configurações
    els.btnSettings.addEventListener('click', openSettings);
    els.btnCloseSettings.addEventListener('click', closeSettings);
    els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeSettings(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });

    els.setName.addEventListener('input', () => {
      settings.userName = els.setName.value.trim();
      saveSettings();
    });
    els.setVoice.addEventListener('change', () => {
      settings.voiceOn = els.setVoice.checked;
      if (!settings.voiceOn) stopSpeaking();
      saveSettings();
    });
    els.setRate.addEventListener('input', () => {
      settings.rate = Number(els.setRate.value);
      els.rateLabel.textContent = settings.rate.toFixed(1) + 'x';
      saveSettings();
    });

    // Apagar tudo (conversa + configurações)
    els.btnWipe.addEventListener('click', () => {
      if (!confirm('Apagar conversa e configurações salvas?')) return;
      try { localStorage.removeItem(STORAGE.settings); localStorage.removeItem(STORAGE.history); } catch (e) { /* ignora */ }
      settings = Object.assign({}, DEFAULT_SETTINGS);
      clearChat();
      closeSettings();
      refreshVoiceButton();
      addMessage('nova', 'Tudo apagado. Olá! Eu sou a NOVA. Como posso ajudar?');
    });

    // Se a pessoa sair do app, para a voz
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopSpeaking(); });
  }

  /* ========================================================
     10. INICIALIZAÇÃO
     ======================================================== */

  function init() {
    // Vozes do aparelho
    if (canSpeak) {
      loadVoices();
      speechSynthesis.onvoiceschanged = loadVoices;
    }

    setupRecognition();
    bindEvents();
    refreshVoiceButton();

    // Mostra o histórico salvo; se não houver, dá as boas-vindas
    if (history.length) {
      history.forEach(renderMessage);
    } else {
      const hello = settings.userName ? 'Olá, ' + settings.userName + '!' : 'Olá!';
      addMessage('nova', hello + ' Eu sou a NOVA, sua assistente virtual. Pode digitar ou tocar no microfone para falar comigo. Diga "Me ajude" para ver o que sei fazer.');
    }
  }

  init();
})();
