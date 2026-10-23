if (new URLSearchParams(location.search).has('fixture')) void import('./proof/main');
else void import('./apps/web/main');
