(function () {
    'use strict';

    // Захист від подвійного підключення
    if (window.plugin_quality_badge_ready) return;
    window.plugin_quality_badge_ready = true;

    /* ================================================================== *
     * НАЛАШТУВАННЯ
     * ================================================================== */
    var QUALITY_TTL = 1000 * 60 * 60 * 24;      // кеш мітки якості одного фільму — 24 години
    var IMDB_MAP_TTL = 1000 * 60 * 60 * 24 * 30; // кеш зв'язку tmdb id → imdb id — 30 днів (не змінюється)

    // Теги якості від кращого до гіршого, з рангом і регуляркою для назви релізу
    var TAGS = [
        { code: 'bd', rank: 4, re: /\b(BluRay|BDRip|BRRip|UHD|2160p)\b/i },
        { code: 'webdl', rank: 3, re: /\bWEB[-.]?(DL|Rip)?\b/i },
        { code: 'hdrip', rank: 2, re: /\b(HDRip|HDTV)\b/i },
        { code: 'dvdrip', rank: 1, re: /\b(DVDRip|DVDScr|DVD)\b/i },
        { code: 'cam', rank: 0, re: /\b(HDCAM|CAM|TELESYNC|TS|TC)\b/i }
    ];

    var network = new Lampa.Reguest();

    /* ================================================================== *
     * Локалізація
     * ================================================================== */
    Lampa.Lang.add({
        qb_bd: { uk: 'Blu-Ray', ru: 'Blu-Ray', en: 'Blu-Ray' },
        qb_webdl: { uk: 'WEB-DL', ru: 'WEB-DL', en: 'WEB-DL' },
        qb_hdrip: { uk: 'HD-Rip', ru: 'HD-Rip', en: 'HD-Rip' },
        qb_dvdrip: { uk: 'DVD-Rip', ru: 'DVD-Rip', en: 'DVD-Rip' },
        qb_cam: { uk: 'CAM/TS', ru: 'CAM/TS', en: 'CAM/TS' }
    });

    /* ================================================================== *
     * CSS
     * ================================================================== */
    function injectStyle() {
        if (document.getElementById('quality_badge_style')) return;
        var style = document.createElement('style');
        style.id = 'quality_badge_style';
        style.textContent = [
            '.full-start-new__poster, .full-start__poster, .card__view { position: relative; }',
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
            '.quality-badge--dvdrip { background: #fb8c00; }',
            '.quality-badge--cam { background: #c62828; }',
            '.quality-badge--mini {',
            '  top: 0.3em; left: 0.3em; padding: 0.15em 0.45em;',
            '  font-size: 0.68em; border-radius: 0.3em; box-shadow: 0 1px 4px rgba(0,0,0,.5);',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    /* ================================================================== *
     * srrDB: пошук релізів фільму за IMDB id (публічне API, без токена)
     * ================================================================== */
    function pickBestTag(results) {
        var best = null;
        (results || []).forEach(function (r) {
            var name = (r && r.release) || '';
            if (!name || /SUBPACK/i.test(name)) return; // не відео-реліз

            for (var i = 0; i < TAGS.length; i++) {
                if (TAGS[i].re.test(name)) {
                    if (!best || TAGS[i].rank > best.rank) best = TAGS[i];
                    break;
                }
            }
        });
        return best ? best.code : null;
    }

    function srrdbLookupByImdb(imdbId, cb) {
        var cacheKey = 'quality_badge_srrdb_' + imdbId;
        var cached = Lampa.Storage.get(cacheKey, null);
        if (cached && cached.ts && (Date.now() - cached.ts) < QUALITY_TTL) {
            cb(cached.code);
            return;
        }

        var numeric = imdbId.replace(/^tt/i, '');
        var url = 'https://api.srrdb.com/v1/search/imdb:' + numeric;

        network.silent(url, function (json) {
            var code = pickBestTag(json && json.results);
            Lampa.Storage.set(cacheKey, { code: code, ts: Date.now() });
            cb(code);
        }, function () {
            cb(null);
        });
    }

    // tmdb id -> imdb id (потрібно для карток каталогу, де imdb_id ще не підвантажений)
    function getImdbId(tmdbId, cb) {
        var cacheKey = 'quality_badge_imdbmap_' + tmdbId;
        var cached = Lampa.Storage.get(cacheKey, null);
        if (cached && cached.ts && (Date.now() - cached.ts) < IMDB_MAP_TTL) {
            cb(cached.imdb || null);
            return;
        }

        var url = Lampa.TMDB.api('movie/' + tmdbId + '/external_ids?api_key=' + Lampa.TMDB.key());

        network.silent(url, function (json) {
            var imdb = (json && json.imdb_id) || null;
            Lampa.Storage.set(cacheKey, { imdb: imdb, ts: Date.now() });
            cb(imdb);
        }, function () {
            cb(null);
        });
    }

    function lookupQuality(data, cb) {
        if (data.imdb_id) { srrdbLookupByImdb(data.imdb_id, cb); return; }
        if (!data.id) { cb(null); return; }

        getImdbId(data.id, function (imdb) {
            if (!imdb) { cb(null); return; }
            srrdbLookupByImdb(imdb, cb);
        });
    }

    function isTv(data) {
        return !!data.first_air_date || !!data.number_of_seasons;
    }

    /* ================================================================== *
     * Малювання бейджа
     * ================================================================== */
    function renderBadgeOn(container, code, mini) {
        container = $(container);
        container.find('.quality-badge').remove();

        var cls = 'quality-badge quality-badge--' + code + (mini ? ' quality-badge--mini' : '');
        var badge = $('<div class="' + cls + '"></div>');
        badge.text(Lampa.Lang.translate('qb_' + code));
        container.append(badge);
    }

    function renderFullBadge(render, code) {
        render = $(render);
        var poster = render.find('.full-start-new__poster, .full-start__poster').eq(0);
        var target = poster.length ? poster : render.find('.full-start-new__rate-line, .full-start__rate').eq(0);
        renderBadgeOn(target, code, false);
    }

    /* ================================================================== *
     * Бейдж на повній картці фільму
     * ================================================================== */
    function startFullListener() {
        Lampa.Listener.follow('full', function (e) {
            try {
                if (e.type !== 'complite') return;

                var movie = e.data && e.data.movie;
                if (!movie || !movie.id) return;
                if (isTv(movie)) return; // тільки фільми

                var render = e.object.activity.render();

                lookupQuality(movie, function (code) {
                    if (code) renderFullBadge(render, code);
                });
            } catch (err) {}
        });
    }

    /* ================================================================== *
     * Бейджі на картках каталогу (гортання стрічок)
     * ================================================================== */
    function processCardElement(el) {
        if (el.qb_done) return;
        el.qb_done = true;

        var data = el.card_data;
        if (!data || !data.id || !data.poster_path) return; // не фільм/серіал (напр. персона, колекція)
        if (isTv(data)) return;

        var view = el.querySelector('.card__view');
        if (!view) return;

        lookupQuality(data, function (code) {
            if (code) renderBadgeOn(view, code, true);
        });
    }

    function scanForCards(root) {
        if (root.nodeType !== 1) return;
        if (root.classList && root.classList.contains('card')) processCardElement(root);
        if (root.querySelectorAll) {
            var found = root.querySelectorAll('.card');
            for (var i = 0; i < found.length; i++) processCardElement(found[i]);
        }
    }

    function startCardObserver() {
        var observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                for (var i = 0; i < m.addedNodes.length; i++) {
                    scanForCards(m.addedNodes[i]);
                }
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });

        scanForCards(document.body); // на випадок карток, що вже на екрані
    }

    /* ================================================================== *
     * Старт
     * ================================================================== */
    function startPlugin() {
        injectStyle();
        startFullListener();
        startCardObserver();
    }

    if (window.appready) startPlugin();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') startPlugin();
        });
    }

})();
