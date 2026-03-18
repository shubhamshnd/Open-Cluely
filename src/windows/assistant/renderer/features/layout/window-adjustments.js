export function createWindowAdjustmentManager({
    windowResizeHandles,
    chatContainer,
    minWindowWidth,
    minWindowHeight,
    onViewportResize
}) {
    let activeWindowResize = null;
    let pendingWindowBounds = null;
    let windowResizeFrame = null;

    function setupWindowAdjustments() {
        setupWindowResizeHandles();
        enforceChatFillLayout();
        window.addEventListener('resize', () => {
            enforceChatFillLayout();
            onViewportResize?.();
        });
    }

    function enforceChatFillLayout() {
        if (!chatContainer) {
            return;
        }

        // Ensure stale manual-resize inline styles never pin chat height.
        chatContainer.style.removeProperty('height');
    }

    function setupWindowResizeHandles() {
        if (!window.electronAPI || !windowResizeHandles.length) {
            return;
        }

        windowResizeHandles.forEach((handle) => {
            handle.addEventListener('pointerdown', startWindowResize);
        });
    }

    async function startWindowResize(event) {
        if (!window.electronAPI?.getWindowBounds || !window.electronAPI?.setWindowBounds) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const handleElement = event.currentTarget;
        if (!handleElement) {
            return;
        }

        const direction = handleElement.dataset.resizeHandle;
        const pointerId = event.pointerId;
        const startScreenX = event.screenX;
        const startScreenY = event.screenY;
        const startBounds = await window.electronAPI.getWindowBounds();
        if (!startBounds || startBounds.error) {
            console.error('Failed to get initial window bounds:', startBounds?.error);
            return;
        }

        activeWindowResize = {
            direction,
            pointerId,
            startScreenX,
            startScreenY,
            startBounds,
            handleElement
        };

        document.body.classList.add('window-resizing');
        handleElement.setPointerCapture?.(pointerId);

        document.addEventListener('pointermove', onWindowResizeMove);
        document.addEventListener('pointerup', stopWindowResize);
        document.addEventListener('pointercancel', stopWindowResize);
    }

    function onWindowResizeMove(event) {
        if (!activeWindowResize || event.pointerId !== activeWindowResize.pointerId) {
            return;
        }

        event.preventDefault();

        const deltaX = event.screenX - activeWindowResize.startScreenX;
        const deltaY = event.screenY - activeWindowResize.startScreenY;
        const nextBounds = calculateWindowResizeBounds(
            activeWindowResize.startBounds,
            activeWindowResize.direction,
            deltaX,
            deltaY
        );

        scheduleWindowResize(nextBounds);
    }

    function calculateWindowResizeBounds(startBounds, direction, deltaX, deltaY) {
        let { x, y, width, height } = startBounds;

        if (direction.includes('e')) {
            width = Math.max(minWindowWidth, startBounds.width + deltaX);
        }

        if (direction.includes('s')) {
            height = Math.max(minWindowHeight, startBounds.height + deltaY);
        }

        if (direction.includes('w')) {
            const nextWidth = Math.max(minWindowWidth, startBounds.width - deltaX);
            x = startBounds.x + (startBounds.width - nextWidth);
            width = nextWidth;
        }

        if (direction.includes('n')) {
            const nextHeight = Math.max(minWindowHeight, startBounds.height - deltaY);
            y = startBounds.y + (startBounds.height - nextHeight);
            height = nextHeight;
        }

        return {
            x: Math.round(x),
            y: Math.round(y),
            width: Math.round(width),
            height: Math.round(height)
        };
    }

    function scheduleWindowResize(bounds) {
        pendingWindowBounds = bounds;
        if (windowResizeFrame) {
            return;
        }

        windowResizeFrame = window.requestAnimationFrame(async () => {
            windowResizeFrame = null;
            const nextBounds = pendingWindowBounds;
            pendingWindowBounds = null;

            if (!nextBounds) {
                return;
            }

            const result = await window.electronAPI.setWindowBounds(nextBounds);
            if (result && result.error) {
                console.error('Failed to set window bounds:', result.error);
            }
        });
    }

    function stopWindowResize(event) {
        if (!activeWindowResize) {
            return;
        }

        if (event.pointerId && event.pointerId !== activeWindowResize.pointerId) {
            return;
        }

        activeWindowResize.handleElement?.releasePointerCapture?.(activeWindowResize.pointerId);
        activeWindowResize = null;
        pendingWindowBounds = null;

        if (windowResizeFrame) {
            window.cancelAnimationFrame(windowResizeFrame);
            windowResizeFrame = null;
        }

        document.body.classList.remove('window-resizing');
        document.removeEventListener('pointermove', onWindowResizeMove);
        document.removeEventListener('pointerup', stopWindowResize);
        document.removeEventListener('pointercancel', stopWindowResize);
    }

    return {
        setupWindowAdjustments
    };
}
