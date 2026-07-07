(function () {
    'use strict';

    // Захист від подвійного підключення
    if (window.plugin_quality_badge_cub_ready) return;
    window.plugin_quality_badge_cub_ready = true;

    /* ================================================================== *
     * НАЛАШТУВАННЯ
     * ================================================================== */
    var MAX_PAGES = 5; // скільки сторінок кожної категорії тягнути
    var INDEX_TTL = 1000 * 60 * 60 * 6; // час життя індексу — 6 годин
    var INDEX_KEY = 'quality_badge_cub_index';
    var DEBUG = true; // true → лог структури відповіді в консоль

    // Категорії CUB від кращої якості до гіршої + ранг (більший = кращий)
    var CATEGORIES = [
        { code: 'bd', rank: 4 },
        { code: 'webdl', rank: 3 },
        { code: 'hdrip', rank: 2 },
        { code: 'dvdrip', rank: 1 }
        // { code: 'update', rank: 0 } // «Оновлення» — не якість; за бажання розкоментуй
    ];

    var network = new Lampa.Reguest();
    var api_url = Lampa.Utils.protocol() + Lampa.Manifest.cub_domain + '/api/quality/';

    function dbg(msg) {
        if (!DEBUG) return;
        try {
            var el = document.getElementById('qb-debug-panel');
            if (!el) {
                el = document.createElement('div');
                el.id = 'qb-debug-panel';
                el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(0,0,0,0.88);' +
                    'color:#0f0;font-size:15px;line-height:1.3;padding:6px 10px;z-index:999999;' +
                    'max-height:38vh;overflow:auto;white-space:pre-wrap;font-family:monospace;';
                (document.body || document.documentElement).appendChild(el);
            }
            var line = document.createElement('div');
            line.textContent = new Date().toISOString().slice(11, 19) + ' ' + msg;
            el.appendChild(line);
            el.scrollTop = el.scrollHeight;
        } catch (e) {}
    }

    /* ================================================================== *
     * Локалізація
     * ================================================================== */
    Lampa.Lang.add({
        qb_bd: { uk: 'Blu-Ray', ru: 'Blu-Ray', en: 'Blu-Ray' },
        qb_webdl: { uk: 'WEB-DL', ru: 'WEB-DL', en: 'WEB-DL' },
        qb_hdrip: { uk: 'HD-Rip', ru: 'HD-Rip', en: 'HD-Rip' },
        qb_dvdrip: { uk: 'DVD-Rip', ru: 'DVD-Rip', en: 'DVD-Rip' }
    });

    /* ================================================================== *
     * CSS
     * ================================================================== */
    function injectStyle() {
        if (document.getElementById('quality_badge_cub_style')) return;
        var style = document.createElement('style');
        style.id = 'quality_badge_cub_style';
        style.textContent = [
            '.full-start-new__poster, .full-start__poster { position: relative; }',
            '.quality-badge {',
            '  position: absolute; top: 0.6em; left: 0.6em;',
            '  padding: 0.3em 0.7em; border-radius: 0.4em;',
            '  font-size: 1.1em; font-weight: 600; line-height: 1;',
            '  color: #fff; z-index: 10; white-space: nowrap;',
            '  box-shadow: 0 2px 8px rgba(0,0,0,.45); letter-spacing: .02em;',
            '}',
            '.quality-badge--bd { background: #1e88e5; }',
            '.quality-badge--webdl { background: #43a047; }',
            '.quality-badge--hdrip { background: #fdd835; color: #212121; }',
            '.quality-badge--dvdrip { background: #fb8c00; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    /* ================================================================== *
     * Запит до CUB (тонкий клієнт, з токеном акаунта)
     * ================================================================== */
    function hasToken() {
        var account = Lampa.Storage.get('account', '{}');
        return !!account.token;
    }

    function get(code, page, resolve, reject) {
        var account = Lampa.Storage.get('account', '{}');
        if (account.token) {
            network.silent(api_url + code + '/' + page, resolve, reject, false, {
                headers: { token: account.token }
            });
        } else {
            reject();
        }
    }

    /* ================================================================== *
     * Побудова індексу id/title → якість
     * ================================================================== */
    function titleKey(item) {
        var t = (item.original_title || item.title || item.name || '')
            .toString().toLowerCase().trim();
        if (!t) return null;
        var date = item.release_date || item.first_air_date || '';
        var year = date ? ('' + date).slice(0, 4) : '';
        return t + '|' + year;
    }

    function addToIndex(item, code, rank, idIndex, titleIndex) {
        if (!item) return;

        if (item.id != null) {
            var cur = idIndex[item.id];
            if (!cur || rank > cur.rank) idIndex[item.id] = { code: code, rank: rank };
        }

        var key = titleKey(item);
        if (key) {
            var c2 = titleIndex[key];
            if (!c2 || rank > c2.rank) titleIndex[key] = { code: code, rank: rank };
        }
    }

    // Послідовно тягне сторінки однієї категорії, доки не порожньо / не MAX_PAGES
    function fetchCategoryPages(cat, idIndex, titleIndex, onCatDone) {
        function loadPage(page) {
            if (page > MAX_PAGES) { onCatDone(); return; }

            get(cat.code, page, function (json) {
                var results = (json && json.results) || [];

                if (DEBUG && page === 1) {
                    Lampa.Noty.show('[qb] ' + cat.code + ' page1: ' + results.length + ' items' +
                        (results.length ? ' sample=' + JSON.stringify(results[0]).slice(0, 200) : ''));
                }

                if (!results.length) { onCatDone(); return; }

                results.forEach(function (item) {
                    addToIndex(item, cat.code, cat.rank, idIndex, titleIndex);
                });

                loadPage(page + 1);
            }, function (err) {
                if (DEBUG) Lampa.Noty.show('[qb] ' + cat.code + ' FAILED: ' + JSON.stringify(err).slice(0, 150));
                onCatDone(); // помилку/кінець категорії просто пропускаємо
            });
        }
        loadPage(1);
    }

    function buildIndex(done) {
        var idIndex = {}, titleIndex = {};
        var remaining = CATEGORIES.length;

        CATEGORIES.forEach(function (cat) {
            fetchCategoryPages(cat, idIndex, titleIndex, function () {
                remaining--;
                if (remaining === 0) {
                    var index = { id: idIndex, title: titleIndex, ts: Date.now() };
                    Lampa.Storage.set(INDEX_KEY, index);
                    if (DEBUG) {
                        console.log('[quality_badge_cub] index built:',
                            Object.keys(idIndex).length, 'by id,',
                            Object.keys(titleIndex).length, 'by title');
                    }
                    done(index);
                }
            });
        });
    }

    /* ================================================================== *
     * Доступ до індексу (памʼять → Storage → побудова), з чергою очікувачів
     * ================================================================== */
    var INDEX = null;
    var building = false;
    var waiters = [];

    function indexFresh(idx) {
        return idx && idx.ts && (Date.now() - idx.ts) < INDEX_TTL;
    }

    function ensureIndex(cb) {
        if (indexFresh(INDEX)) { cb(INDEX); return; }

        var stored = Lampa.Storage.get(INDEX_KEY, null);
        if (indexFresh(stored)) { INDEX = stored; cb(INDEX); return; }

        waiters.push(cb);
        if (building) return;
        building = true;

        buildIndex(function (index) {
            INDEX = index;
            building = false;
            var list = waiters.slice();
            waiters = [];
            list.forEach(function (fn) { fn(index); });
        });
    }

    /* ================================================================== *
     * Пошук якості для конкретної картки
     * ================================================================== */
    function lookup(index, movie) {
        if (!index) return null;
        if (movie.id != null && index.id[movie.id]) return index.id[movie.id].code;
        var key = titleKey(movie);
        if (key && index.title[key]) return index.title[key].code;
        return null;
    }

    /* ================================================================== *
     * Малювання бейджа
     * ================================================================== */
    function renderBadge(render, code) {
        render = $(render);
        render.find('.quality-badge').remove();

        var badge = $('<div class="quality-badge quality-badge--' + code + '"></div>');
        badge.text(Lampa.Lang.translate('qb_' + code));

        var poster = render.find('.full-start-new__poster, .full-start__poster').eq(0);
        if (poster.length) poster.append(badge);
        else render.find('.full-start-new__rate-line, .full-start__rate').eq(0).append(badge);
    }

    /* ================================================================== *
     * Старт
     * ================================================================== */
    function startPlugin() {
        injectStyle();
        dbg('[qb] startPlugin() called');

        Lampa.Listener.follow('full', function (e) {
            try {
                dbg('[qb] full event: ' + e.type);
                if (e.type !== 'complite') return;

                dbg('[qb] hasToken=' + hasToken() + ' account=' + JSON.stringify(Lampa.Storage.get('account', '{}')).slice(0, 200));
                if (!hasToken()) return; // без CUB-токена джерела міток немає

                var movie = e.data && e.data.movie;
                if (!movie || !movie.id) { dbg('[qb] no movie/id'); return; }

                // Тільки фільми (серіали CUB тут не віддає у форматі quality)
                var is_tv = (e.object && e.object.method === 'tv') ||
                    !!movie.first_air_date || !!movie.number_of_seasons;
                if (is_tv) { dbg('[qb] skipped: is_tv'); return; }

                dbg('[qb] building index for movie.id=' + movie.id);

                var render = e.object.activity.render();

                try {
                    var img = render.find('img').first();
                    var chain = [];
                    var el = img;
                    for (var i = 0; i < 6 && el && el.length; i++) {
                        var tag = (el.prop('tagName') || '?').toLowerCase();
                        var cls = el.attr('class') || '';
                        chain.push(tag + '.' + cls);
                        el = el.parent();
                    }
                    dbg('[qb] DOM chain: ' + chain.join(' < '));
                    dbg('[qb] selector hits: new=' + render.find('.full-start-new__poster').length + ' old=' + render.find('.full-start__poster').length + ' imgs=' + render.find('img').length);
                } catch (domErr) {
                    dbg('[qb] DOM dump error: ' + domErr.message);
                }

                ensureIndex(function (index) {
                    dbg('[qb] index ready: id-count=' + Object.keys(index.id || {}).length + ' title-count=' + Object.keys(index.title || {}).length);
                    var code = lookup(index, movie);
                    dbg('[qb] lookup result: ' + code);
                    if (code) renderBadge(render, code);
                });
            } catch (err) {
                dbg('[qb] FATAL in full-listener: ' + (err && err.message) + ' | ' + (err && err.stack || '').slice(0, 300));
            }
        });
    }

    dbg('[qb] plugin script loaded, appready=' + window.appready);
    if (window.appready) startPlugin();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') startPlugin();
        });
    }

})();
