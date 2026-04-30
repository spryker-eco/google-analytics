import register from 'ShopUi/app/registry';

export default register('traceable-events-google-analytics', () =>
    import(
        /* webpackMode: "lazy" */
        /* webpackChunkName: "traceable-events-google-analytics" */
        './traceable-events-google-analytics'
    ),)