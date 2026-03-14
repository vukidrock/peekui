(function () {
    let active = false;
    let overlay = null;
    let highlighter = null;
    let breadcrumbBadge = null;
    let labels = []; // Array of {element, position, targetElement}
    let selectedElement = null;
    const modifiedProperties = new WeakMap();

    // Property map for Live Edit
    const propertyMap = {
        'Size': 'fontSize',
        'Weight': 'fontWeight',
        'Color': 'color',
        'Radius': 'borderRadius',
        'Padding': 'padding',
        'Bg Color': 'backgroundColor',
        'Object Fit': 'objectFit',
        'Shadow': 'boxShadow'
    };

    // Helper functions
    const rgbToHex = (rgb) => {
        if (!rgb || rgb === 'rgba(0, 0, 0, 0)') return 'transparent';
        const parts = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)$/);
        if (!parts) return rgb;

        const r = parseInt(parts[1]);
        const g = parseInt(parts[2]);
        const b = parseInt(parts[3]);
        const a = parts[4] ? parseFloat(parts[4]) : 1;

        if (a === 0) return 'transparent';

        const toHex = (n) => n.toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}${a < 1 ? toHex(Math.round(a * 255)) : ''}`.toUpperCase();
    };

    const getDOMPath = (el) => {
        const path = [];
        let current = el;
        let count = 0;

        while (current && current.tagName !== 'HTML' && count < 3) {
            let selector = current.tagName.toLowerCase();
            if (current.id) {
                selector += `#${current.id}`;
            } else if (current.className && typeof current.className === 'string') {
                const firstClass = current.className.split(' ').find(c =>
                    c && !c.startsWith('ali-inspector') && !c.startsWith('peekui-') && !c.startsWith('exported-')
                );
                if (firstClass) {
                    selector += `.${firstClass}`;
                }
            }
            if (count === 0) {
                selector = `<span class="peekui-breadcrumb-active">${selector}</span>`;
            }
            path.unshift(selector);
            current = current.parentElement;
            count++; // Up to 3 levels (current + 2 parents)
        }

        let result = path.join(' > ');
        // Return full string and let CSS handle truncation because substring breaks HTML tags
        return result;
    };

    let copyTimeout = null;
    const handleCopyClick = (e) => {
        // detail > 1 means it's part of a double/triple click
        if (e.detail > 1) {
            if (copyTimeout) clearTimeout(copyTimeout);
            return;
        }
        if (e.target.tagName === 'INPUT') return;

        const row = e.target.closest('.copyable-row');
        if (!row) return;

        const copyValue = row.getAttribute('data-copy-value');
        if (!copyValue) return;

        // Small delay to ensure we don't show feedback during a double-click
        copyTimeout = setTimeout(() => {
            navigator.clipboard.writeText(copyValue).then(() => {
                const valueSpan = row.querySelector('.ali-inspector-label-value');
                if (!valueSpan || valueSpan.tagName === 'INPUT') return;

                const originalText = valueSpan.textContent;
                valueSpan.textContent = 'Copied!';
                valueSpan.classList.add('ali-inspector-value-copied');

                setTimeout(() => {
                    valueSpan.textContent = originalText;
                    valueSpan.classList.remove('ali-inspector-value-copied');
                }, 1000);
            });
        }, 200);
    };

    const handleValueDblClick = (e, propName, targetEl) => {
        const span = e.target;
        if (span.tagName === 'INPUT') return;

        // Clear any pending copy timeout to prevent feedback from appearing
        if (copyTimeout) {
            clearTimeout(copyTimeout);
            copyTimeout = null;
        }

        const row = span.closest('.copyable-row');
        const originalValue = row ? row.getAttribute('data-copy-value') : span.textContent;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'ali-inspector-edit-input';
        input.value = originalValue;

        span.parentNode.replaceChild(input, span);
        input.focus();
        input.select();

        const commit = () => {
            const newValue = input.value;
            const cssProp = propertyMap[propName];
            if (cssProp && targetEl) {
                targetEl.style[cssProp] = newValue;
                // Update copy value if it exists
                const row = input.closest('.copyable-row');
                if (row) row.setAttribute('data-copy-value', newValue);
            }
            span.textContent = newValue;
            if (newValue !== originalValue) {
                span.classList.add('is-modified');

                // Save modifier state
                if (!modifiedProperties.has(targetEl)) {
                    modifiedProperties.set(targetEl, new Set());
                }
                modifiedProperties.get(targetEl).add(propName);
            }
            input.parentNode.replaceChild(span, input);
            updateCanvas(); // Refresh highlighter/connections
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
                span.textContent = originalValue;
                input.parentNode.replaceChild(span, input);
            }
        });
        input.addEventListener('blur', commit);
    };

    const createLabel = (title, items, dir, targetEl) => {
        const label = document.createElement('div');
        label.className = 'ali-inspector-label';
        label.dataset.targetId = Math.random().toString(36).substr(2, 9);

        // Pin Icon
        const pinIcon = document.createElement('div');
        pinIcon.className = 'ali-inspector-pin';
        pinIcon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z" /></svg>`;
        pinIcon.onclick = (e) => {
            e.stopPropagation();
            label.classList.toggle('is-pinned');
            updateCanvas();
        };
        label.appendChild(pinIcon);

        const header = document.createElement('div');
        header.style.fontWeight = '700';
        header.style.marginBottom = '6px';
        header.style.color = '#3b82f6';
        header.style.fontSize = '9px';
        header.style.letterSpacing = '0.05em';
        header.style.textTransform = 'uppercase';
        header.textContent = title;
        label.appendChild(header);

        items.forEach(item => {
            const row = document.createElement('div');
            const isCopyable = item.copyValue !== undefined;
            row.className = `ali-inspector-label-item ${isCopyable ? 'copyable-row' : ''}`;
            if (isCopyable) {
                row.setAttribute('data-copy-value', item.copyValue);
            }

            const nameSpan = document.createElement('span');
            nameSpan.className = 'ali-inspector-label-name';
            nameSpan.textContent = item.name;

            const valueSpan = document.createElement('span');
            valueSpan.className = 'ali-inspector-label-value';
            if (modifiedProperties.get(targetEl)?.has(item.name)) {
                valueSpan.classList.add('is-modified');
            }
            valueSpan.textContent = item.value;

            // Live Edit
            if (propertyMap[item.name]) {
                valueSpan.ondblclick = (e) => handleValueDblClick(e, item.name, targetEl);
                valueSpan.style.cursor = 'text';
            }

            row.appendChild(nameSpan);
            row.appendChild(valueSpan);
            label.appendChild(row);
        });

        label.addEventListener('click', handleCopyClick);
        document.body.appendChild(label);
        return { element: label, position: dir, targetElement: targetEl };
    };

    const clearUI = () => {
        if (highlighter) highlighter.remove();
        if (breadcrumbBadge) breadcrumbBadge.remove();
        const canvas = document.getElementById('inspector-canvas');
        if (canvas) canvas.remove();

        // Remove only non-pinned labels
        const remainingLabels = [];
        labels.forEach(l => {
            if (l.element.classList.contains('is-pinned')) {
                remainingLabels.push(l);
            } else {
                l.element.remove();
            }
        });
        labels = remainingLabels;

        highlighter = null;
        breadcrumbBadge = null;
        selectedElement = null;
        clearGuides();
    };

    const clearGuides = () => {
        document.querySelectorAll('.ali-inspector-guide, .ali-inspector-guide-label').forEach(el => el.remove());
    };

    function drawConnection(startX, startY, endX, endY, isDashed = false) {
        const canvas = document.getElementById('inspector-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        ctx.beginPath();
        ctx.arc(startX, startY, 4, 0, 2 * Math.PI);
        ctx.fillStyle = isDashed ? '#e5e7eb' : '#cbd5e1';
        ctx.fill();

        const cp1X = startX + (endX - startX) / 2;
        const cp1Y = startY;
        const cp2X = startX + (endX - startX) / 2;
        const cp2Y = endY;

        ctx.beginPath();
        if (isDashed) ctx.setLineDash([4, 4]);
        else ctx.setLineDash([]);

        ctx.moveTo(startX, startY);
        ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, endX, endY);
        ctx.strokeStyle = isDashed ? '#e5e7eb' : '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]); // Reset
    }

    function setupCanvas() {
        let canvas = document.getElementById('inspector-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'inspector-canvas';
            canvas.style.position = 'fixed';
            canvas.style.top = '0';
            canvas.style.left = '0';
            canvas.style.pointerEvents = 'none';
            canvas.style.zIndex = '999998';
            document.body.appendChild(canvas);
        }
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    const updateCanvas = () => {
        const canvas = document.getElementById('inspector-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const padding = 15;

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (selectedElement && highlighter) {
            const rect = selectedElement.getBoundingClientRect();
            highlighter.style.left = `${rect.left}px`;
            highlighter.style.top = `${rect.top}px`;
            highlighter.style.width = `${rect.width}px`;
            highlighter.style.height = `${rect.height}px`;

            if (breadcrumbBadge) {
                const badgeRect = breadcrumbBadge.getBoundingClientRect();
                let topPos = rect.top - badgeRect.height - 4;
                if (topPos < 0) {
                    topPos = rect.top + 4; // Push inside the element if clipped
                }

                let leftPos = rect.left;
                // Prevent badge from overflowing the right edge of the screen
                if (leftPos + badgeRect.width > window.innerWidth - 8) {
                    leftPos = window.innerWidth - badgeRect.width - 8;
                }

                breadcrumbBadge.style.left = `${Math.max(4, leftPos)}px`;
                breadcrumbBadge.style.top = `${topPos}px`;
            }
        }

        // 1. Calculate and resolve positions for current labels
        const currentLabels = labels.filter(l => l.targetElement === selectedElement && !l.element.classList.contains('is-pinned'));

        currentLabels.forEach(labelObj => {
            const elRect = labelObj.targetElement.getBoundingClientRect();
            // Force redraw to ensure we have latest dimensions if text changed
            const labelRect = labelObj.element.getBoundingClientRect();
            labelObj._w = labelRect.width;
            labelObj._h = labelRect.height;

            let targetX, targetY;
            if (labelObj.position === 'left') {
                targetX = elRect.left - labelObj._w - 20;
                targetY = elRect.top + elRect.height / 2 - labelObj._h / 2;
            } else if (labelObj.position === 'right') {
                targetX = elRect.right + 20;
                targetY = elRect.top + elRect.height / 2 - labelObj._h / 2;
            } else {
                targetX = elRect.left + elRect.width / 2 - labelObj._w / 2;
                targetY = elRect.bottom + 20;
            }

            labelObj._x = Math.max(padding, Math.min(window.innerWidth - labelObj._w - padding, targetX));
            labelObj._y = Math.max(padding, Math.min(window.innerHeight - labelObj._h - padding, targetY));
        });

        // Anti-overlap relaxation loop
        let badgeRect = null;
        if (breadcrumbBadge) {
            badgeRect = breadcrumbBadge.getBoundingClientRect();
        }

        for (let iter = 0; iter < 10; iter++) {
            let moved = false;
            for (let i = 0; i < currentLabels.length; i++) {
                const l1 = currentLabels[i];
                const gap = 12;

                // 1. Check collision with Breadcrumb Badge
                if (badgeRect && l1._y < badgeRect.bottom + gap && l1._y + l1._h > badgeRect.top - gap &&
                    l1._x < badgeRect.right + gap && l1._x + l1._w > badgeRect.left - gap) {

                    // Push label down below the badge
                    l1._y = badgeRect.bottom + gap;
                    moved = true;
                }

                // 2. Check collision with other labels
                for (let j = i + 1; j < currentLabels.length; j++) {
                    const l2 = currentLabels[j];

                    // Check if bounding boxes intersect
                    if (l1._x < l2._x + l2._w + gap && l1._x + l1._w + gap > l2._x &&
                        l1._y < l2._y + l2._h + gap && l1._y + l1._h + gap > l2._y) {

                        // Push vertically to separate them
                        const overlapY = (Math.min(l1._y + l1._h, l2._y + l2._h) - Math.max(l1._y, l2._y)) + gap;
                        let topL = l1._y < l2._y ? l1 : l2;
                        let bottomL = l1._y < l2._y ? l2 : l1;

                        if (bottomL._y + bottomL._h + overlapY > window.innerHeight - padding) {
                            // If bottom label would go off-screen, push top label UP instead
                            topL._y -= overlapY;
                        } else {
                            bottomL._y += overlapY;
                        }
                        moved = true;
                    }
                }
            }
            if (!moved) break;
        }

        // Apply computed positions
        currentLabels.forEach(l => {
            // Final clamp in case relaxation pushed a label completely off-screen upwards
            l._y = Math.max(padding, Math.min(window.innerHeight - l._h - padding, l._y));
            l.element.style.left = `${l._x}px`;
            l.element.style.top = `${l._y}px`;
        });

        // 2. Draw connections for all labels (including pinned ones)
        labels.forEach(labelObj => {
            const elRect = labelObj.targetElement.getBoundingClientRect();
            // Get accurate layout using the just-applied styles
            const currentLabelRect = labelObj.element.getBoundingClientRect();

            let startX, startY, endX, endY;
            const isPinned = labelObj.element.classList.contains('is-pinned');

            if (labelObj.position === 'left') {
                startX = elRect.left;
                startY = elRect.top + elRect.height / 3;
                endX = currentLabelRect.right;
                endY = currentLabelRect.top + currentLabelRect.height / 2;
            } else if (labelObj.position === 'right') {
                startX = elRect.right;
                startY = elRect.top + elRect.height * 0.6;
                endX = currentLabelRect.left;
                endY = currentLabelRect.top + currentLabelRect.height / 2;
            } else {
                startX = elRect.left + elRect.width / 2;
                startY = elRect.bottom;
                endX = currentLabelRect.left + currentLabelRect.width / 2;
                endY = currentLabelRect.top;
            }
            drawConnection(startX, startY, endX, endY, isPinned);
        });
    };

    const findTargetElement = (x, y) => {
        const elements = document.elementsFromPoint(x, y);
        const filtered = elements.filter(el => {
            if (el.classList.contains('ali-inspector-overlay')) return false;
            if (el.classList.contains('ali-inspector-highlighter')) return false;
            if (el.classList.contains('peekui-breadcrumb-badge')) return false;
            if (el.classList.contains('ali-inspector-label')) return false;
            if (el.classList.contains('ali-inspector-guide')) return false;
            if (el.classList.contains('ali-inspector-toast')) return false;
            if (el === document.body || el === document.documentElement) return false;
            return true;
        });
        if (filtered.length === 0) return null;
        const image = filtered.find(el => el.tagName === 'IMG');
        return image || filtered[0];
    };

    const showToast = (message, type = 'default') => {
        let toast = document.querySelector('.ali-inspector-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'ali-inspector-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.className = 'ali-inspector-toast show';
        if (type === 'tailwind') toast.classList.add('ali-inspector-toast-tailwind');

        setTimeout(() => toast.classList.remove('show'), 2000);
    };

    const convertToTailwind = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const classes = [];

        // Helper for arbitrary values
        const arb = (prefix, value) => {
            if (!value || value === '0px' || value === 'none' || value === 'normal' || value === 'rgba(0, 0, 0, 0)' || value === 'transparent') return '';
            return `${prefix}-[${value.replace(/\s+/g, '_')}]`;
        };

        // Layout
        if (style.display === 'flex') classes.push('flex');
        if (style.display === 'grid') classes.push('grid');
        if (style.display === 'inline-flex') classes.push('inline-flex');

        if (style.flexDirection === 'column') classes.push('flex-col');
        if (style.alignItems !== 'normal') classes.push(arb('items', style.alignItems));
        if (style.justifyContent !== 'normal') classes.push(arb('justify', style.justifyContent));

        // Size
        classes.push(arb('w', `${Math.round(rect.width)}px`));
        classes.push(arb('h', `${Math.round(rect.height)}px`));

        // Background
        const bgColor = rgbToHex(style.backgroundColor);
        if (bgColor !== 'transparent') classes.push(`bg-[${bgColor}]`);

        // Typography
        if (el.tagName !== 'IMG') {
            classes.push(arb('text', style.fontSize));
            const weight = style.fontWeight;
            classes.push(`font-[${weight}]`);
            const color = rgbToHex(style.color);
            classes.push(`text-[${color}]`);
            classes.push(arb('leading', style.lineHeight));
            if (style.textAlign !== 'start') classes.push(`text-${style.textAlign}`);
        } else {
            classes.push(`object-${style.objectFit}`);
        }

        // Spacing
        if (style.padding !== '0px') classes.push(arb('p', style.padding));
        if (style.margin !== '0px') classes.push(arb('m', style.margin));

        // Border & Shape
        if (style.borderRadius !== '0px') classes.push(arb('rounded', style.borderRadius));
        if (style.borderWidth !== '0px') {
            classes.push('border');
            classes.push(arb('border', style.borderWidth));
            classes.push(arb('border', rgbToHex(style.borderColor)));
        }

        const opacity = parseFloat(style.opacity);
        if (opacity < 1) classes.push(`opacity-[${opacity}]`);

        return classes.filter(c => c).join(' ');
    };

    const exportToTailwind = () => {
        if (!selectedElement) return;
        const tailwindClasses = convertToTailwind(selectedElement);
        navigator.clipboard.writeText(tailwindClasses).then(() => {
            showToast('🌊 Tailwind Classes Copied!', 'tailwind');
        });
    };

    const getCSSString = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        const props = [
            `width: ${Math.round(rect.width)}px;`,
            `height: ${Math.round(rect.height)}px;`,
            `background: ${rgbToHex(style.backgroundColor)};`,
            `border-radius: ${style.borderRadius};`,
            `padding: ${style.padding};`
        ];

        if (element.tagName !== 'IMG') {
            props.push(`font-size: ${style.fontSize};`);
            props.push(`font-weight: ${style.fontWeight};`);
            props.push(`color: ${rgbToHex(style.color)};`);
        } else {
            props.push(`object-fit: ${style.objectFit};`);
        }

        const shadow = style.boxShadow;
        if (shadow !== 'none') props.push(`box-shadow: ${shadow};`);

        return `.exported-element {\n  ${props.join('\n  ')}\n}`;
    };

    const exportToCSS = () => {
        if (!selectedElement) return;
        const cssRule = getCSSString(selectedElement);
        navigator.clipboard.writeText(cssRule).then(() => {
            showToast('🎉 CSS Copied to Clipboard!');
        });
    };

    const saveToStash = async () => {
        if (!selectedElement) return;

        const style = window.getComputedStyle(selectedElement);
        const bgColor = rgbToHex(style.backgroundColor);
        const cssCode = getCSSString(selectedElement);
        const tailwindCode = convertToTailwind(selectedElement);
        // Stripping HTML tags from getDOMPath in case it has the orange highlight span
        const elementName = getDOMPath(selectedElement).replace(/<[^>]*>?/gm, '');

        const item = {
            url: window.location.href,
            domain: window.location.hostname,
            elementName,
            bgColor,
            cssCode,
            tailwindCode
        };

        const data = await chrome.storage.local.get('peekui_stash');
        const stash = data.peekui_stash || [];
        stash.push(item);
        await chrome.storage.local.set({ peekui_stash: stash });

        showToast('📦 Saved to Stash!');
    };

    const inspectElement = (eOrEl) => {
        clearUI();
        let el;
        if (eOrEl instanceof HTMLElement) {
            el = eOrEl;
        } else {
            overlay.style.display = 'none';
            el = findTargetElement(eOrEl.clientX, eOrEl.clientY);
            overlay.style.display = 'block';
        }

        if (!el || el === overlay) return;
        selectedElement = el;

        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);

        highlighter = document.createElement('div');
        highlighter.className = 'ali-inspector-highlighter';
        highlighter.style.left = `${rect.left}px`;
        highlighter.style.top = `${rect.top}px`;
        highlighter.style.width = `${rect.width}px`;
        highlighter.style.height = `${rect.height}px`;
        document.body.appendChild(highlighter);

        if (!breadcrumbBadge) {
            breadcrumbBadge = document.createElement('div');
            breadcrumbBadge.className = 'peekui-breadcrumb-badge';
            document.body.appendChild(breadcrumbBadge);
        }
        breadcrumbBadge.innerHTML = getDOMPath(el);

        setupCanvas();

        let groups = {};
        const fontFamily = style.fontFamily;
        let colorCopy = rgbToHex(style.color);
        if (fontFamily.includes('Google') || fontFamily.includes('Inter')) {
            // Suggesting Google Fonts link on copy for popular ones
            colorCopy += ` /* Font: https://fonts.google.com/specimen/${fontFamily.split(',')[0].trim().replace(/['"]/g, '')} */`;
        }

        if (el.tagName === 'IMG') {
            groups = {
                image: [
                    { name: 'Natural', value: `${el.naturalWidth} x ${el.naturalHeight}px` },
                    { name: 'Display', value: `${Math.round(rect.width)} x ${Math.round(rect.height)}px` },
                    { name: 'Source', value: el.src.split('/').pop().substring(0, 20) + '...', copyValue: el.src }
                ],
                shape: [
                    { name: 'Radius', value: style.borderRadius, copyValue: style.borderRadius },
                    { name: 'Padding', value: style.padding, copyValue: style.padding }
                ],
                background: [
                    { name: 'Object Fit', value: style.objectFit, copyValue: style.objectFit },
                    { name: 'Bg Color', value: rgbToHex(style.backgroundColor), copyValue: rgbToHex(style.backgroundColor) }
                ]
            };
            labels.push(createLabel('Image Asset', groups.image, 'left', el));
        } else {
            groups = {
                font: [
                    { name: 'Size', value: style.fontSize, copyValue: style.fontSize },
                    { name: 'Weight', value: style.fontWeight, copyValue: style.fontWeight },
                    { name: 'Color', value: rgbToHex(style.color), copyValue: colorCopy }
                ],
                shape: [
                    { name: 'Radius', value: style.borderRadius, copyValue: style.borderRadius },
                    { name: 'Padding', value: style.padding, copyValue: style.padding }
                ],
                background: [
                    { name: 'Bg Color', value: rgbToHex(style.backgroundColor), copyValue: rgbToHex(style.backgroundColor) }
                ]
            };

            // Box Shadow
            if (style.boxShadow !== 'none') {
                const parts = style.boxShadow.split(') ');
                const cleanShadow = (parts[parts.length - 1] || style.boxShadow).substring(0, 20) + '...';
                groups.background.push({ name: 'Shadow', value: cleanShadow, copyValue: style.boxShadow });
            }

            // Gradient
            if (style.backgroundImage.includes('gradient')) {
                groups.background.unshift({ name: 'Gradient', value: 'Detected', copyValue: style.backgroundImage });
            }

            labels.push(createLabel('Typography', groups.font, 'left', el));
        }

        labels.push(createLabel('Geometry', groups.shape, 'right', el));
        labels.push(createLabel('Appearance', groups.background, 'bottom', el));

        requestAnimationFrame(updateCanvas);
    };

    const createGuide = (x, y, w, h, value) => {
        const guide = document.createElement('div');
        guide.className = `ali-inspector-guide ${w > h ? 'ali-inspector-guide-line-h' : 'ali-inspector-guide-line-v'}`;
        guide.style.left = `${x}px`;
        guide.style.top = `${y}px`;
        guide.style.width = `${w}px`;
        guide.style.height = `${h}px`;
        document.body.appendChild(guide);

        if (value !== undefined) {
            const label = document.createElement('div');
            label.className = 'ali-inspector-guide-label';
            label.style.left = `${x + w / 2}px`;
            label.style.top = `${y + h / 2}px`;
            label.textContent = `${Math.round(value)}px`;
            document.body.appendChild(label);
        }
    };

    const drawMeasurementGuides = (e) => {
        if (!selectedElement || !e.altKey) {
            clearGuides();
            return;
        }

        overlay.style.display = 'none';
        const hovered = findTargetElement(e.clientX, e.clientY);
        overlay.style.display = 'block';

        if (!hovered || hovered === selectedElement) {
            clearGuides();
            return;
        }

        clearGuides();
        const r1 = selectedElement.getBoundingClientRect();
        const r2 = hovered.getBoundingClientRect();

        if (r2.bottom < r1.top) {
            createGuide(r1.left + r1.width / 2, r2.bottom, 1, r1.top - r2.bottom, r1.top - r2.bottom);
        } else if (r2.top > r1.bottom) {
            createGuide(r1.left + r1.width / 2, r1.bottom, 1, r2.top - r1.bottom, r2.top - r1.bottom);
        }

        if (r2.right < r1.left) {
            createGuide(r2.right, r1.top + r1.height / 2, r1.left - r2.right, 1, r1.left - r2.right);
        } else if (r2.left > r1.right) {
            createGuide(r1.right, r1.top + r1.height / 2, r2.left - r1.right, 1, r2.left - r1.right);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            deactivate();
            chrome.runtime.sendMessage({ action: 'deactivated' });
        } else if (e.key === 'ArrowUp' && selectedElement) {
            e.preventDefault();
            const parent = selectedElement.parentElement;
            if (parent && parent !== document.body && parent !== document.documentElement) {
                inspectElement(parent);
            }
        } else if (e.key === 'ArrowDown' && selectedElement) {
            e.preventDefault();
            const child = selectedElement.firstElementChild;
            if (child) {
                inspectElement(child);
            }
        } else if (e.key === ' ' && selectedElement) {
            e.preventDefault();
            if (e.shiftKey) {
                exportToTailwind();
            } else {
                exportToCSS();
            }
        } else if ((e.ctrlKey || e.metaKey) && e.key === 's' && selectedElement) {
            e.preventDefault();
            saveToStash();
        }
    };

    const activate = () => {
        if (active) return;
        active = true;
        overlay = document.createElement('div');
        overlay.className = 'ali-inspector-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', inspectElement);
        window.addEventListener('resize', updateCanvas);
        window.addEventListener('scroll', updateCanvas);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('mousemove', drawMeasurementGuides);
    };

    const deactivate = () => {
        if (!active) return;
        active = false;
        if (overlay) overlay.remove();
        clearUI();
        // Force remove pinned ones on full deactivate
        document.querySelectorAll('.ali-inspector-label').forEach(el => el.remove());
        window.removeEventListener('resize', updateCanvas);
        window.removeEventListener('scroll', updateCanvas);
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('mousemove', drawMeasurementGuides);
    };

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'activate') activate();
        if (msg.action === 'deactivate') deactivate();
        if (msg.action === 'toggle_inspect') {
            if (active) deactivate();
            else activate();
        }
    });

})();
