// This file fixes THREE.js loading issues

// Check if THREE is loaded
window.addEventListener('DOMContentLoaded', function() {
    setTimeout(checkThreeLoading, 500);
});

function checkThreeLoading() {
    if (typeof THREE === 'undefined') {
        console.error("THREE.js failed to load from CDN. Attempting local fallback...");
        loadLocalThree();
    } else {
        console.log("THREE.js loaded successfully:", THREE.REVISION);
    }
}

function loadLocalThree() {
    // Create status message
    const status = document.getElementById('status');
    if (status) {
        status.textContent = "THREE.js CDN failed, loading local copy...";
        status.style.opacity = 1;
    }
    
    // Create script elements with more reliable loading
    const threeScript = document.createElement('script');
    threeScript.src = "https://cdn.jsdelivr.net/npm/three@0.156.0/build/three.min.js";
    threeScript.onload = function() {
        console.log("THREE.js loaded from local fallback");
        
        // Now load OrbitControls
        const orbitScript = document.createElement('script');
        orbitScript.src = "https://cdn.jsdelivr.net/npm/three@0.156.0/examples/js/controls/OrbitControls.js";
        orbitScript.onload = function() {
            console.log("OrbitControls loaded");
            
            // Force page reload to use the new scripts
            if (status) {
                status.textContent = "Libraries loaded, reinitializing...";
                setTimeout(() => location.reload(), 1000);
            }
        };
        document.head.appendChild(orbitScript);
    };
    document.head.appendChild(threeScript);
}