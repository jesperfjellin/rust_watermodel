// Standalone WebGL diagnostics

// Expose diagnostics globally
window.webglDiagnostics = {
    checkWebGL: function() {
        const canvas = document.querySelector('canvas');
        if (!canvas) return "No canvas found";
        
        try {
            // Try to get WebGL context directly
            const gl = canvas.getContext('webgl2') || 
                      canvas.getContext('webgl') || 
                      canvas.getContext('experimental-webgl');
            
            if (!gl) return "WebGL not supported";
            
            // Get basic WebGL information
            return {
                glVersion: gl.getParameter(gl.VERSION),
                glVendor: gl.getParameter(gl.VENDOR),
                glRenderer: gl.getParameter(gl.RENDERER),
                extensions: gl.getSupportedExtensions(),
                maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
                maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS)
            };
        } catch (err) {
            return "Error getting WebGL context: " + err.message;
        }
    },
    
    forceReset: function() {
        // Get all canvases
        const canvases = document.querySelectorAll('canvas');
        if (canvases.length === 0) return "No canvas elements found";
        
        // Force reset for each canvas
        canvases.forEach(canvas => {
            // Try to trigger context reset
            const contextNames = ['webgl2', 'webgl', 'experimental-webgl'];
            for (const name of contextNames) {
                try {
                    const ctx = canvas.getContext(name, { failIfMajorPerformanceCaveat: false });
                    if (ctx) {
                        const loseExt = ctx.getExtension('WEBGL_lose_context');
                        if (loseExt) {
                            loseExt.loseContext();
                            setTimeout(() => loseExt.restoreContext(), 500);
                            console.log(`Reset WebGL context for canvas: ${canvas.id || 'unnamed'}`);
                        }
                    }
                } catch (e) {
                    console.error("Error resetting context:", e);
                }
            }
        });
        
        // Force page redraw
        setTimeout(() => {
            location.reload();
        }, 1000);
        
        return "Attempting to reset WebGL contexts and reload page...";
    }
};

console.log("WebGL diagnostics loaded - use webglDiagnostics.checkWebGL() in console");