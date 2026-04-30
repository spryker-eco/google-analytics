import register from 'ShopUi/app/registry';

export default register('google-analytics', () =>
    import(
        /* webpackMode: "lazy" */
        /* webpackChunkName: "google-analytics" */
        './google-analytics'
    ),)