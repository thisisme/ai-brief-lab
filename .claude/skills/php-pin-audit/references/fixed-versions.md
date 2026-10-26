# PHP2Shell fixed versions (php.net, Oct 21, 2026)

CVE-2026-109618 and CVE-2026-109619 allow unauthenticated remote code execution on
any PHP install that serves web requests (PHP-FPM, Apache mod_php, php-cgi,
FrankenPHP, LiteSpeed). Apache mod_php carries the highest demonstrated risk.

| Branch        | First fixed release                        |
| ------------- | ------------------------------------------ |
| 8.5           | 8.5.12                                     |
| 8.4           | 8.4.27                                     |
| 8.3           | 8.3.36                                     |
| 8.2           | 8.2.35                                     |
| 8.6           | 8.6.0 RC4 (not for production)             |
| 8.1, 8.0, 7.4 | no official release; source backports only |
| 7.3 and older | no fix                                     |

The only complete fix is upgrading. watchTowr reports that .ini changes are not an
effective mitigation. PHP's CLI is not exposed to web requests, but update it too.
