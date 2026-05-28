import { createApp, ref, computed, nextTick } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js'

const DAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

// https://open-meteo.com/en/docs#weather_variable_documentation

const WCode = {
  0: { label: "Soleggiato", icon: "fa-sun" },

  1: { label: "Parzialmente soleggiato", icon: "fa-cloud-sun" },
  2: { label: "Parzialmente nuvoloso", icon: "fa-cloud-sun" },
  3: { label: "Nuvoloso", icon: "fa-cloud" },

  45: { label: "Nebbioso", icon: "fa-smog" },
  48: { label: "Tanta nebbia", icon: "fa-smog" },

  51: { label: "Piogga leggera", icon: "fa-cloud-sun-rain" },
  53: { label: "Piogga moderata", icon: "fa-cloud-sun-rain" },
  55: { label: "Piogga pesante", icon: "fa-cloud-rain" },

  56: { label: "Nuvoloso", icon: "fa-cloud-meatball" },
  57: { label: "Nuvoloso ", icon: "fa-cloud-meatball" },

  61: { label: "Piogga leggera", icon: "fa-cloud-sun-rain" },
  63: { label: "Pioggia moderata", icon: "fa-cloud-rain" },
  65: { label: "Pioggia pesante", icon: "fa-cloud-rain" },

  66: { label: "Pioggia leggera con grandine", icon: "fa-cloud-meatball" },
  67: { label: "Pioggia pesante con grandine", icon: "fa-cloud-meatball" },

  71: { label: "Nevicata leggera", icon: "fa-cloud-meatball" },
  73: { label: "Nevicata moderata", icon: "fa-snowflake" },
  75: { label: "Nevicata pesante", icon: "fa-snowflake" },

  77: { label: "Granelli di neve", icon: "fa-snowflake" },

  80: { label: "Pioggia leggera con nuvole", icon: "fa-cloud-sun-rain" },
  81: { label: "Pioggia moderata con nuvole", icon: "fa-cloud-rain" },
  82: { label: "Piogga violenta con nuvole", icon: "fa-cloud-bolt" },

  85: { label: "Nevicata leggera", icon: "fa-cloud-meatball" },
  86: { label: "Nevicata pesante", icon: "fa-snowflake" },

  95: { label: "Temporale", icon: "fa-cloud-bolt" },

  96: { label: "Temporale con grandine", icon: "fa-cloud-bolt" },
  99: { label: "Temporale con grandine", icon: "fa-cloud-bolt" }
};

const toF = (c) => Math.round(c * 9 / 5 + 32);

// Funzione creata con l'aiuto di AI
function buildSparkline(temps) {
    const W = 336, H = 36;
    if (!temps || temps.length < 2) return '';
    const minT = Math.min(...temps);
    const maxT = Math.max(...temps);
    const range = (maxT - minT) || 1;
    return temps.map((t, i) => {
        const x = (i / (temps.length - 1)) * W;
        const y = H - ((t - minT) / range) * (H - 6) - 3;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
}

function hourIcon(code, hour) {
    const day = hour >= 6 && hour < 20;
    if (code === 0) return day ? 'fa-sun' : 'fa-moon';
    if (code === 1 || code === 2) return day ? 'fa-cloud-sun' : 'fa-cloud-moon';
    if (code === 51 || code === 53 || code === 61 || code === 80) return day ? 'fa-cloud-sun-rain' : 'fa-cloud-moon-rain';
    return (WCode[code] && WCode[code].icon) || 'fa-cloud';
}

createApp({
    setup() {
        const city = ref('Mestre');
        const weather = ref(null); // Dati del meteo correnti
        const forecast = ref([]);
        const loading = ref(false);
        const error = ref('');
        const isCelsius = ref(true);
        const isOffline = ref(!navigator.onLine);

        window.addEventListener('online', () => isOffline.value = false);
        window.addEventListener('offline', () => isOffline.value = true);

        const unitLabel = computed(() => isCelsius.value ? '°C' : '°F');
        const toggleUnit = () => isCelsius.value = !isCelsius.value;
        const disp = (c) => isCelsius.value ? c : toF(c);
        const suggestions = ref([]);
        const showSuggestions = ref(false);
        const selectedPlace = ref(null);
        let suggestTimer = null;

        const onCityInput = () => {
            selectedPlace.value = null;
            clearTimeout(suggestTimer);
            const q = city.value.trim();
            if (q.length < 2) {
                suggestions.value = [];
                showSuggestions.value = false;
                return;
            }
            suggestTimer = setTimeout(async () => {
                if (isOffline.value) return;
                try {
                    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=it&format=json`);
                    const data = await res.json();
                    suggestions.value = (data.results || []).map(r => ({
                        name: r.name,
                        place: r.admin1 || '',
                        country: (r.country_code || '').toUpperCase(),
                        lat: r.latitude,
                        lon: r.longitude
                    }));
                    showSuggestions.value = suggestions.value.length > 0;
                } catch {
                    suggestions.value = [];
                    showSuggestions.value = false;
                }
            }, 200);
        };

        const selectSuggestion = (s) => {
            const place = {
                name: s.name,
                country: s.country,
                latitude: s.lat,
                longitude: s.lon
            };
            selectedPlace.value = place;
            city.value = s.name;
            suggestions.value = [];
            showSuggestions.value = false;
            fetchWeather(place);
        };

        const hideSuggestions = () => {
            setTimeout(() => {
                showSuggestions.value = false;
            }, 150);
        };

        const hourlyData = ref([]);
        const sparklinePoints = ref(''); // Per creare l'immagine svg
        const selectedDayLabel = ref('Oggi');
        const showHourly = ref(false);
        const hourlyScrollEl = ref(null);

        let rawTime = [];
        let rawTemp = [];
        let rawWCode = [];
        let rawDates = [];

        const buildHourlyForDate = (dateStr) => {
            const todayDate = rawDates[0] || '';
            const isToday = dateStr === todayDate;
            const nowHour = new Date().getHours();
            const slots = [];

            for (let i = 0; i < rawTime.length; i++) {
                const timeStr = rawTime[i];
                if (timeStr.slice(0, 10) !== dateStr) continue;

                const h = parseInt(timeStr.slice(11, 13), 10);
                const code = rawWCode[i];
                slots.push({
                    hour: String(h).padStart(2, '0') + ':00',
                    tempC: Math.round(rawTemp[i]),
                    icon: hourIcon(code, h),
                    isCurrent: isToday && h === nowHour
                });
            }
            return slots;
        };

        const openHourlyDate = ref(null);

        const selectDay = async (dateStr, label) => {
            if (!dateStr) return;
            if (showHourly.value && openHourlyDate.value === dateStr) {
                showHourly.value = false;
                openHourlyDate.value = null;
                return;
            }
            const slots = buildHourlyForDate(dateStr);
            if (!slots.length) return;

            openHourlyDate.value = dateStr;
            hourlyData.value = slots;
            sparklinePoints.value = buildSparkline(slots.map(s => s.tempC));
            selectedDayLabel.value = label;
            showHourly.value = true;

            await nextTick(); // Evita casi in cui Vue non aggiorna il dom
            const el = hourlyScrollEl.value;
            if (!el) return;
            const currentIdx = slots.findIndex(s => s.isCurrent);
            const target = currentIdx >= 0 ? currentIdx : 0;
            el.scrollTo({
                left: Math.max(0, target * 52 - 20),
                behavior: 'smooth'
            });
        };

        const closeHourly = () => {
            showHourly.value = false;
            openHourlyDate.value = null;
        };

        const forecastRange = computed(() => {
            if (!forecast.value.length) return {
                min: 0,
                max: 1
            };
            const mins = forecast.value.map(d => d.minC);
            const maxs = forecast.value.map(d => d.maxC);
            return {
                min: Math.min(...mins),
                max: Math.max(...maxs)
            };
        });

        // Funzione creata con l'aiuto di AI
        const barStyle = (day) => {
            const {
                min,
                max
            } = forecastRange.value;
            const span = (max - min) || 1;
            const left = ((day.minC - min) / span * 100).toFixed(1);
            const right = (100 - (day.maxC - min) / span * 100).toFixed(1);
            return `left:${left}%; right:${right}%`;
        };

        const CACHE_KEY = 'meteo';

        const saveCache = (place, wData, cw) => {
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify({place, wData, cw, savedAt: Date.now()}));
            } catch {
            }
        };

        const loadCache = () => {
            try {
                const raw = localStorage.getItem(CACHE_KEY);
                return raw ? JSON.parse(raw) : null;
            } catch {
                return null;
            }
        };

        const applyWeatherData = (place, wData, cw) => {
            rawTime = wData.hourly.time;
            rawTemp = wData.hourly.temperature_2m;
            rawWCode = wData.hourly.weathercode;
            rawDates = wData.daily.time;

            const nowHour = new Date(cw.time).getHours();
            const humidity = wData.hourly.relativehumidity_2m ? (wData.hourly.relativehumidity_2m[nowHour] ?? '—') : '—';

            const wc = WCode[cw.weathercode] || { label: '', icon: 'fa-cloud' };
            weather.value = {
                name: place.name,
                country: place.country || '',
                temperatureC: Math.round(cw.temperature),
                wind: Math.round(cw.windspeed),
                humidity,
                label: wc.label,
                icon: wc.icon,
                todayDate: rawDates[0]
            };

            forecast.value = rawDates.slice(1, 7).map((date, i) => {
                const idx = i + 1;
                const code = wData.daily.weathercode[idx];
                const fc = WCode[code] || {
                    icon: 'fa-cloud'
                };
                return {
                    date,
                    day: DAYS[new Date(date + 'T12:00:00').getDay()],
                    maxC: Math.round(wData.daily.temperature_2m_max[idx]),
                    minC: Math.round(wData.daily.temperature_2m_min[idx]),
                    icon: fc.icon
                };
            });
        };

        const fetchWeather = async (place) => {
            loading.value = true;
            error.value = '';
            weather.value = null;
            forecast.value = [];
            hourlyData.value = [];
            showHourly.value = false;

            try {
                const url = `https://api.open-meteo.com/v1/forecast` +
                    `?latitude=${place.latitude}&longitude=${place.longitude}` +
                    `&current_weather=true` +
                    `&hourly=temperature_2m,weathercode,relativehumidity_2m` +
                    `&daily=weathercode,temperature_2m_max,temperature_2m_min` +
                    `&timezone=auto`;

                const res = await fetch(url);
                const wData = await res.json();
                const cw = wData.current_weather;

                applyWeatherData(place, wData, cw);
                saveCache(place, wData, cw);
            } catch (e) {
                console.error(e);
                const cached = loadCache();
                if (cached) {
                    isOffline.value = true;
                    applyWeatherData(cached.place, cached.wData, cached.cw);
                    const mins = Math.round((Date.now() - cached.savedAt) / 60000);
                    error.value = `Offline — dati di ${mins} min fa (${cached.place.name})`;
                } else {
                    error.value = 'Errore caricamento dati';
                }
            } finally {
                loading.value = false;
            }
        };

        const searchWeather = async () => {
            if (!city.value.trim() || isOffline.value) return;
            if (selectedPlace.value) {
                const p = selectedPlace.value;
                selectedPlace.value = null;
                await fetchWeather(p);
                return;
            }
            try {
                loading.value = true;
                error.value = '';
                const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city.value)}&count=1&language=it&format=json`);
                const data = await res.json();
                if (!data.results || !data.results.length) {
                    error.value = 'Città non trovata';
                    loading.value = false;
                    return;
                }
                const r = data.results[0];
                await fetchWeather({
                    name: r.name,
                    country: (r.country_code || '').toUpperCase(),
                    latitude: r.latitude,
                    longitude: r.longitude
                });
            } catch (e) {
                console.error(e);
                const cached2 = loadCache();
                if (cached2) {
                    isOffline.value = true;
                    applyWeatherData(cached2.place, cached2.wData, cached2.cw);
                    const mins = Math.round((Date.now() - cached2.savedAt) / 60000);
                    error.value = `Offline — dati di ${mins} min fa (${cached2.place.name})`;
                } else {
                    error.value = 'Errore caricamento dati';
                }
                loading.value = false;
            }
        };

        const cached = loadCache();
        if (cached) {
            applyWeatherData(cached.place, cached.wData, cached.cw);
            const mins = Math.round((Date.now() - cached.savedAt) / 60000);
            error.value = `Dati di ${mins} min fa — aggiornamento in corso…`;
        }
        if (!isOffline.value) {
            if (cached) {
                fetchWeather(cached.place).then(() => {
                    if (error.value.startsWith('Dati di')) error.value = '';
                });
            } else {
                searchWeather();
            }
        } else if (cached) {
            const mins = Math.round((Date.now() - cached.savedAt) / 60000);
            error.value = `Offline — dati di ${mins} min fa (${cached.place.name})`;
        }

        if ('serviceWorker' in navigator)
            navigator.serviceWorker.register('/Meteo/sw.js');

        return {
            city, weather, forecast, loading,
            error, isCelsius, unitLabel, toggleUnit,
            disp, isOffline, suggestions, showSuggestions,
            hourlyData, sparklinePoints, selectedDayLabel, showHourly,
            hourlyScrollEl, openHourlyDate, onCityInput, selectSuggestion,
            hideSuggestions, selectDay, closeHourly, barStyle, searchWeather
        };
    }
}).mount('#app');

// https://www.vantajs.com/
VANTA.GLOBE({
           el: "#vanta-bg",
           mouseControls: true,
           touchControls: true,
           gyroControls: false,
           minHeight: 200.00,
           minWidth: 200.00,
           scale: 1.00,
           scaleMobile: 1.00,
           color: 0x3fecff,
           backgroundColor: 0xf0f21
})