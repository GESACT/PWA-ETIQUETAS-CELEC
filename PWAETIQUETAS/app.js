const onlineStatusSpan = document.getElementById('online-status');
const dataCountSpan = document.getElementById('data-count');
const pendingPrintCountSpan = document.getElementById('pending-print-count');
const pendingPrintCountBtnSpan = document.getElementById('pending-print-count-btn');
const loadFileInput = document.getElementById('load-file-input');
const searchInput = document.getElementById('search-input');
const bienesContainer = document.getElementById('bienes-container');
const printPendingBtn = document.getElementById('print-pending-btn');
const clearPendingBtn = document.getElementById('clear-pending-btn');
const printableArea = document.getElementById('printable-area');

let allBienesData = []; // Catálogo completo de bienes (desde el JSON cargado)
let bienesToPrint = new Map(); // Mapa de ID -> Bien con el nuevo código y estado 'pendiente'

// --- IndexedDB para almacenamiento offline de datos y selecciones ---
const DB_NAME = 'BienesInventarioDB';
const DB_VERSION = 2; // Incrementar la versión de la DB si se cambia la estructura
const BIENES_MAESTROS_STORE = 'bienes_maestros'; // Para el catálogo completo
const BIENES_PENDIENTES_STORE = 'bienes_pendientes'; // Para bienes que necesitan etiqueta

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = function(event) {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(BIENES_MAESTROS_STORE)) {
                db.createObjectStore(BIENES_MAESTROS_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(BIENES_PENDIENTES_STORE)) {
                // 'bienes_pendientes' almacenará el ID del bien, el nuevo código, y otros datos para la impresión
                db.createObjectStore(BIENES_PENDIENTES_STORE, { keyPath: 'id' });
            }
        };

        request.onsuccess = function(event) {
            resolve(event.target.result);
        };

        request.onerror = function(event) {
            console.error('Error abriendo IndexedDB:', event.target.errorCode);
            reject(event.target.errorCode);
        };
    });
}

// Guarda el catálogo maestro de bienes en IndexedDB
async function saveBienesMaestrosToIndexedDB(data) {
    const db = await openDatabase();
    const transaction = db.transaction(BIENES_MAESTROS_STORE, 'readwrite');
    const store = transaction.objectStore(BIENES_MAESTROS_STORE);

    store.clear(); // Limpiar datos anteriores
    data.forEach(item => {
        if (!item.id) { // Asegurarse de que cada bien tenga un ID único
            item.id = item.CodigoActual || item.NombreProducto + Math.random().toString(36).substr(2, 5); // Fallback
        }
        store.put(item);
    });

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => {
            console.log('Catálogo de bienes guardado en IndexedDB.');
            resolve();
        };
        transaction.onerror = (event) => reject(event.target.errorCode);
    });
}

// Carga el catálogo maestro de bienes desde IndexedDB
async function loadBienesMaestrosFromIndexedDB() {
    const db = await openDatabase();
    const transaction = db.transaction(BIENES_MAESTROS_STORE, 'readonly');
    const store = transaction.objectStore(BIENES_MAESTROS_STORE);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.errorCode);
    });
}

// Guarda un bien marcado como pendiente en IndexedDB (con su nuevo código)
async function saveBienPendienteToIndexedDB(bien) {
    const db = await openDatabase();
    const transaction = db.transaction(BIENES_PENDIENTES_STORE, 'readwrite');
    const store = transaction.objectStore(BIENES_PENDIENTES_STORE);
    store.put(bien); // Guarda o actualiza

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => {
            console.log(`Bien ${bien.id} marcado como pendiente y guardado.`);
            resolve();
        };
        transaction.onerror = (event) => reject(event.target.errorCode);
    });
}

// Carga todos los bienes marcados como pendientes desde IndexedDB
async function loadBienesPendientesFromIndexedDB() {
    const db = await openDatabase();
    const transaction = db.transaction(BIENES_PENDIENTES_STORE, 'readonly');
    const store = transaction.objectStore(BIENES_PENDIENTES_STORE);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
            bienesToPrint = new Map(event.target.result.map(bien => [bien.id, bien]));
            console.log('Bienes pendientes cargados desde IndexedDB.');
            resolve();
        };
        request.onerror = (event) => reject(event.target.errorCode);
    });
}

// Elimina un bien o todos los bienes de la cola de pendientes
async function clearBienesPendientesFromIndexedDB(id = null) {
    const db = await openDatabase();
    const transaction = db.transaction(BIENES_PENDIENTES_STORE, 'readwrite');
    const store = transaction.objectStore(BIENES_PENDIENTES_STORE);

    if (id) {
        store.delete(id);
    } else {
        store.clear();
    }

    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => {
            console.log(id ? `Bien ${id} eliminado de pendientes.` : 'Cola de pendientes limpiada.');
            resolve();
        };
        transaction.onerror = (event) => reject(event.target.errorCode);
    });
}

// --- Lógica de la Aplicación ---

// Genera un código único basado en el ID del bien y un timestamp para asegurar unicidad
function generateNewCode(bienId) {
    const timestamp = Date.now().toString(36); // Base 36 para hacerlo más corto
    const random = Math.random().toString(36).substr(2, 4);
    // Combina el ID del bien, timestamp y un aleatorio. Puedes personalizar el formato.
    return `BIEN-${bienId.substring(0, 5).toUpperCase()}-${timestamp}-${random}`.replace(/[^A-Z0-9-]/g, '');
}

async function initializeApp() {
    onlineStatusSpan.textContent = navigator.onLine ? 'Online' : 'Offline';

    // Cargar datos maestros y pendientes de IndexedDB al inicio
    allBienesData = await loadBienesMaestrosFromIndexedDB();
    await loadBienesPendientesFromIndexedDB();

    displayBienes(); // Muestra la lista con el estado de "pendiente"
    updateCounts();

    if (allBienesData.length === 0) {
        bienesContainer.innerHTML = '<p>Por favor, usa el botón "Cargar Catálogo de Bienes" para iniciar. Asegúrate de tener el archivo JSON en tu dispositivo.</p>';
    }
}

function displayBienes(searchTerm = '') {
    bienesContainer.innerHTML = '';
    const lowerSearchTerm = searchTerm.toLowerCase();

    const filteredBienes = allBienesData.filter(bien => {
        return (bien.CodigoActual && bien.CodigoActual.toLowerCase().includes(lowerSearchTerm)) ||
               (bien.NombreProducto && bien.NombreProducto.toLowerCase().includes(lowerSearchTerm)) ||
               (bien.Descripcion && bien.Descripcion.toLowerCase().includes(lowerSearchTerm));
    });

    if (filteredBienes.length === 0) {
        bienesContainer.innerHTML = '<p>No se encontraron bienes con ese criterio.</p>';
        return;
    }

    filteredBienes.forEach(bien => {
        const isPending = bienesToPrint.has(bien.id);
        const displayBien = isPending ? bienesToPrint.get(bien.id) : bien; // Usa los datos pendientes si existen

        const div = document.createElement('div');
        div.className = 'bien-item';
        div.innerHTML = `
            <div class="bien-info">
                <strong>ID:</strong> ${bien.id}<br>
                <strong>Código Actual:</strong> ${bien.CodigoActual || 'N/A'}<br>
                <strong>Nombre:</strong> ${bien.NombreProducto || 'N/A'}<br>
                <strong>Nuevo Código:</strong> <span class="new-code">${displayBien.NuevoCodigo || 'Generar'}</span>
            </div>
            <div class="bien-actions">
                <input type="checkbox" id="mark-${bien.id}" data-bien-id="${bien.id}" ${isPending ? 'checked' : ''}>
                <label for="mark-${bien.id}">Marcar para Etiquetar</label>
            </div>
        `;
        bienesContainer.appendChild(div);

        // Listener para el checkbox
        const checkbox = div.querySelector(`#mark-${bien.id}`);
        checkbox.addEventListener('change', async (event) => {
            if (event.target.checked) {
                // Marcar y generar nuevo código
                const newCode = generateNewCode(bien.id);
                const bienWithNewCode = { ...bien, NuevoCodigo: newCode, estadoEtiqueta: 'pendiente' };
                bienesToPrint.set(bien.id, bienWithNewCode);
                await saveBienPendienteToIndexedDB(bienWithNewCode);
            } else {
                // Desmarcar
                bienesToPrint.delete(bien.id);
                await clearBienesPendientesFromIndexedDB(bien.id);
            }
            updateCounts();
            // Actualiza el texto del nuevo código sin recargar toda la lista
            div.querySelector('.new-code').textContent = (bienesToPrint.has(bien.id) ? bienesToPrint.get(bien.id).NuevoCodigo : 'Generar');
        });
    });
}

function updateCounts() {
    dataCountSpan.textContent = allBienesData.length;
    pendingPrintCountSpan.textContent = bienesToPrint.size;
    pendingPrintCountBtnSpan.textContent = bienesToPrint.size;
}

function generateAndPrintLabels() {
    if (bienesToPrint.size === 0) {
        alert('No hay etiquetas marcadas como pendientes para imprimir.');
        return;
    }

    printableArea.innerHTML = '';
    const labelsToGenerate = Array.from(bienesToPrint.values()); // Convertir Map a Array de bienes

    labelsToGenerate.forEach(bien => {
        // Asegúrate de usar 'NuevoCodigo' para la impresión
        const labelHtml = `
            <div class="label-template-item">
                <p><strong>CÓDIGO:</strong> ${bien.NuevoCodigo || bien.id}</p>
                <p><strong>BIEN:</strong> ${bien.NombreProducto || 'N/A'}</p>
                <p><strong>DESCRIPCIÓN:</strong> ${bien.Descripcion || 'N/A'}</p>
                <p><strong>FECHA GENERACIÓN:</strong> ${new Date().toLocaleDateString('es-EC')}</p>
                <svg class="barcode" jsbarcode-format="CODE128" jsbarcode-value="${bien.NuevoCodigo || bien.id}" jsbarcode-width="1.5" jsbarcode-height="40" jsbarcode-displayValue="true"></svg>
            </div>
        `;
        printableArea.innerHTML += labelHtml;
    });

    // Inicializar códigos de barras después de inyectar el HTML
    if (typeof JsBarcode !== 'undefined') {
        JsBarcode(".barcode").init();
    }

    const printWindow = window.open('', '_blank');
    printWindow.document.write('<html><head><title>Imprimir Etiquetas</title>');
    printWindow.document.write('<link rel="stylesheet" href="style.css">');
    printWindow.document.write('</head><body>');
    printWindow.document.write(printableArea.innerHTML);
    printWindow.document.write('</body></html>');
    printWindow.document.close();

    printWindow.focus();
    printWindow.print();
    printWindow.close();

    // Después de imprimir, podrías preguntar si desea limpiar la cola
    // o limpiar automáticamente si el proceso de impresión fue exitoso.
    // clearPendingLabels();
}

async function clearPendingLabels() {
    if (confirm('¿Estás seguro de que quieres limpiar la lista de etiquetas pendientes? Esto eliminará todas las etiquetas de la cola.')) {
        await clearBienesPendientesFromIndexedDB();
        bienesToPrint.clear(); // Limpiar el Map en memoria
        displayBienes(); // Re-renderizar para desmarcar checkboxes
        updateCounts();
        alert('Lista de etiquetas pendientes limpiada.');
    }
}

// --- Event Listeners ---
loadFileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file) {
        if (file.name.endsWith('.json')) {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    await saveBienesMaestrosToIndexedDB(data);
                    allBienesData = data; // Carga los datos en memoria
                    await loadBienesPendientesFromIndexedDB(); // Recarga los pendientes por si acaso
                    displayBienes();
                    updateCounts();
                    alert('Catálogo de bienes cargado y guardado offline con éxito.');
                } catch (error) {
                    console.error('Error al procesar el archivo JSON:', error);
                    alert('Error al leer el archivo. Asegúrate de que sea un archivo JSON válido.');
                }
            };
            reader.readAsText(file);
        } else {
            alert('Por favor, selecciona un archivo JSON.');
        }
    }
});

searchInput.addEventListener('input', (event) => displayBienes(event.target.value));
printPendingBtn.addEventListener('click', generateAndPrintLabels);
clearPendingBtn.addEventListener('click', clearPendingLabels);

// Registro del Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => console.log('Service Worker registrado:', registration))
            .catch(error => console.log('Fallo el registro del Service Worker:', error));
    });
}

// Inicializar la aplicación al cargar
initializeApp();