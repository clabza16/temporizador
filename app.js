/**
 * Achs Demo Day Timer - Logic & Synchronization
 * Developed by Antigravity
 */

const app = {
    // Configuración
    role: null, // 'admin' o 'spectator'
    state: {
        timeRemaining: 300, // 5 minutos por defecto
        isRunning: false,
        startTime: null,
        initialMinutes: 5,
        lastUpdated: Date.now()
    },
    timerInterval: null,
    wakeLock: null,
    
    // Gun.js para sincronización descentralizada (sin servidor)
    db: null,
    room: null,

    init() {
        console.log("Iniciando aplicación...");
        this.cacheDOM();
        this.bindEvents();
        this.initSync();
    },

    cacheDOM() {
        this.dom = {
            roleSelector: document.getElementById('role-selector'),
            adminPanel: document.getElementById('admin-panel'),
            timerValue: document.getElementById('timer-value'),
            connectionStatus: document.getElementById('connection-status'),
            btnStart: document.getElementById('btn-start'),
            btnPause: document.getElementById('btn-pause'),
            btnReset: document.getElementById('btn-reset'),
            inputMinutes: document.getElementById('input-minutes'),
            toggleWakeLock: document.getElementById('toggle-wake-lock')
        };
    },

    bindEvents() {
        this.dom.btnStart.onclick = () => this.startTimer();
        this.dom.btnPause.onclick = () => this.pauseTimer();
        this.dom.btnReset.onclick = () => this.resetTimer();
        this.dom.inputMinutes.onchange = (e) => this.updateInitialTime(e.target.value);
        this.dom.toggleWakeLock.onchange = (e) => this.handleWakeLock(e.target.checked);

        // Atajos de teclado
        window.addEventListener('keydown', (e) => {
            if (this.role !== 'admin') return;
            if (e.code === 'Space') {
                e.preventDefault();
                this.state.isRunning ? this.pauseTimer() : this.startTimer();
            } else if (e.code === 'KeyR') {
                this.resetTimer();
            }
        });
    },

    initSync() {
        // Usaremos un broker MQTT público (EMQX) altamente confiable vía WebSockets
        this.client = mqtt.connect('wss://broker.emqx.io:8084/mqtt');
        this.topicState = 'achs-demo-day/timer/state';
        this.topicRequest = 'achs-demo-day/timer/request';

        this.client.on('connect', () => {
            console.log("Conectado al servidor de sincronización global");
            this.dom.connectionStatus.innerText = "Sincronizado (Global)";
            this.dom.connectionStatus.classList.remove('disconnected');
            this.dom.connectionStatus.classList.add('connected');
            
            this.client.subscribe(this.topicState);
            this.client.subscribe(this.topicRequest);
        });

        this.client.on('message', (topic, message) => {
            try {
                const payload = JSON.parse(message.toString());
                
                if (topic === this.topicState) {
                    if (this.role === 'spectator' || !this.role) {
                        this.state.isRunning = payload.isRunning;
                        this.state.timeRemaining = payload.timeRemaining;
                        
                        // FIX: No usar el lastUpdated del servidor/admin porque los relojes de las computadoras 
                        // pueden tener segundos de diferencia. Sincronizamos con el momento en que llega el mensaje.
                        this.state.lastUpdated = Date.now();
                        
                        if (this.state.isRunning) {
                            this.resumeTimerLogic();
                        } else {
                            this.stopTimerLogic();
                        }
                        this.updateDisplay();
                    }
                } else if (topic === this.topicRequest) {
                    if (this.role === 'admin') {
                        // Un nuevo espectador solicitó el estado, se lo enviamos
                        this.syncState();
                    }
                }
            } catch (e) {
                console.error("Error al procesar el mensaje MQTT", e);
            }
        });

        // Fallback local visual
        const savedState = localStorage.getItem('achsTimerState');
        if (savedState) {
            try {
                const parsed = JSON.parse(savedState);
                this.state.isRunning = parsed.isRunning;
                this.state.timeRemaining = parsed.timeRemaining;
                this.state.lastUpdated = parsed.lastUpdated;
                if (this.state.isRunning) this.resumeTimerLogic();
                this.updateDisplay();
            } catch(e) {}
        }
    },

    setRole(role) {
        this.role = role;
        this.dom.roleSelector.classList.add('fade-out');
        
        if (role === 'admin') {
            this.dom.adminPanel.classList.remove('hidden');
            this.syncState();
        } else if (role === 'spectator') {
            if (this.client && this.client.connected) {
                this.client.publish(this.topicRequest, JSON.stringify({ action: 'REQUEST_STATE' }));
            }
        }
        
        // Solicitar wake lock si el checkbox está activo por defecto (opcional)
        if (this.dom.toggleWakeLock.checked) {
            this.handleWakeLock(true);
        }
    },

    updateInitialTime(mins) {
        this.state.initialMinutes = parseInt(mins);
        this.resetTimer();
    },

    startTimer() {
        if (this.state.isRunning) return;
        this.state.isRunning = true;
        this.state.lastUpdated = Date.now();
        this.syncState();
        this.resumeTimerLogic();
    },

    pauseTimer() {
        this.state.isRunning = false;
        this.state.lastUpdated = Date.now();
        this.syncState();
        this.stopTimerLogic();
    },

    resetTimer() {
        this.state.isRunning = false;
        this.state.timeRemaining = this.dom.inputMinutes.value * 60;
        this.state.lastUpdated = Date.now();
        this.syncState();
        this.stopTimerLogic();
        this.updateDisplay();
    },

    resumeTimerLogic() {
        clearInterval(this.timerInterval);
        
        // Ajuste por latencia: calculamos el tiempo real transcurrido si ya estaba corriendo
        if (this.state.isRunning) {
            const now = Date.now();
            const elapsed = Math.floor((now - this.state.lastUpdated) / 1000);
            this.state.timeRemaining = Math.max(0, this.state.timeRemaining - elapsed);
        }

        this.timerInterval = setInterval(() => {
            if (this.state.timeRemaining > 0) {
                this.state.timeRemaining--;
                this.updateDisplay();
                
                // Si soy admin, sincronizo cada 5 segundos para mantener a todos alineados
                if (this.role === 'admin' && this.state.timeRemaining % 5 === 0) {
                    this.syncState();
                }
            } else {
                this.onTimerEnd();
            }
        }, 1000);
    },

    stopTimerLogic() {
        clearInterval(this.timerInterval);
    },

    syncState() {
        if (this.role !== 'admin' || !this.client) return;
        
        const stateData = {
            timeRemaining: this.state.timeRemaining,
            isRunning: this.state.isRunning,
            lastUpdated: Date.now()
        };

        // Guardamos en localStorage para cuando se abra una nueva ventana
        localStorage.setItem('achsTimerState', JSON.stringify(stateData));

        // Transmitimos globalmente al broker MQTT para múltiples computadoras
        this.client.publish(this.topicState, JSON.stringify(stateData));
    },

    updateDisplay() {
        const h = Math.floor(this.state.timeRemaining / 3600);
        const m = Math.floor((this.state.timeRemaining % 3600) / 60);
        const s = this.state.timeRemaining % 60;

        const format = (val) => val.toString().padStart(2, '0');
        this.dom.timerValue.innerText = `${format(h)}:${format(m)}:${format(s)}`;

        // Feedback visual
        if (this.state.timeRemaining < 60) {
            this.dom.timerValue.classList.add('warning');
        } else {
            this.dom.timerValue.classList.remove('warning');
        }
    },

    onTimerEnd() {
        this.state.isRunning = false;
        this.stopTimerLogic();
        this.updateDisplay();
        this.syncState();
        // Alerta visual final
        this.dom.timerValue.style.color = 'var(--achs-orange)';
        console.log("Temporizador finalizado");
    },

    async handleWakeLock(enable) {
        if (!('wakeLock' in navigator)) {
            console.warn("Wake Lock no soportado en este navegador.");
            return;
        }

        try {
            if (enable) {
                this.wakeLock = await navigator.wakeLock.request('screen');
                console.log("Wake Lock activado");
                this.wakeLock.addEventListener('release', () => {
                    console.log("Wake Lock liberado");
                });
            } else {
                if (this.wakeLock) {
                    await this.wakeLock.release();
                    this.wakeLock = null;
                }
            }
        } catch (err) {
            console.error(`${err.name}, ${err.message}`);
        }
    }
};

// Auto-inicio
document.addEventListener('DOMContentLoaded', () => app.init());
