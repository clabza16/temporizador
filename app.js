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
        // Incluimos Gun.js dinámicamente si no está (aunque se recomienda en el HTML)
        if (typeof Gun === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/gun/gun.js';
            script.onload = () => this.setupGun();
            document.head.appendChild(script);
        } else {
            this.setupGun();
        }
    },

    setupGun() {
        // Usamos un relay público de Gun.js
        this.db = Gun(['https://gun-manhattan.herokuapp.com/gun']);
        // Sala única para la Demo Day de hoy
        const today = new Date().toISOString().split('T')[0];
        this.room = this.db.get('achs-demo-day-timer-' + today);

        this.dom.connectionStatus.innerText = "Sincronizado";
        this.dom.connectionStatus.classList.remove('disconnected');
        this.dom.connectionStatus.classList.add('connected');

        // Escuchar cambios de otros clientes
        this.room.on((data) => {
            if (this.role === 'spectator' || (!this.role && data)) {
                console.log("Sincronización recibida:", data);
                this.state.isRunning = data.isRunning;
                this.state.timeRemaining = data.timeRemaining;
                this.state.lastUpdated = data.lastUpdated;
                
                if (this.state.isRunning) {
                    this.resumeTimerLogic();
                } else {
                    this.stopTimerLogic();
                }
                this.updateDisplay();
            }
        });
    },

    setRole(role) {
        this.role = role;
        this.dom.roleSelector.classList.add('fade-out');
        
        if (role === 'admin') {
            this.dom.adminPanel.classList.remove('hidden');
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
        if (this.role !== 'admin' || !this.room) return;
        this.room.put({
            timeRemaining: this.state.timeRemaining,
            isRunning: this.state.isRunning,
            lastUpdated: Date.now()
        });
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
