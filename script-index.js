function copiar() {
            navigator.clipboard.writeText(document.getElementById("historia-adulto").innerText);
        }

document.addEventListener("DOMContentLoaded", () => {
    const ap_1 = document.getElementById("text-ap-1");
    const ap_1_en_tto = document.getElementById("text-en-tto-1");
    const ap_1_tto = document.getElementById("text-ap-tto-1")
    const ap_linea_2 = document.getElementById("ap-linea-2");

    const ap_2 = document.getElementById("text-ap-2");
    const ap_2_en_tto = 

    //Manejo input AP-1
    ap_1.addEventListener("focus", () => {
        ap_linea_2.classList.remove("oculto");
    });
    ap_1.addEventListener("blur", () => {
        if (ap_1.value.trim().length == 0) {
            ap_linea_2.classList.add("oculto");
        }
    });

    //Manejo input AP-1 tratamiento
    ap_1_tto.addEventListener("focus", () => {
        if (ap_1.value.trim().length > 0) {
            ap_1_en_tto.classList.remove("tachado");
            ap_1_tto.classList.remove("inactivo");
        }
    });
    ap_1_tto.addEventListener("blur", () => {
        if (ap_1_tto.value.trim() == 0) {
            ap_1_en_tto.classList.add("tachado");
            ap_1_tto.classList.add("inactivo");
        }
    });

    //Manejo input AP-2
});