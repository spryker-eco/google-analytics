import register from 'ShopUi/app/registry';

export default register('sprk-google-analytics', () =>
    import(
        /* webpackMode: "lazy" */
        /* webpackChunkName: "sprk-google-analytics" */
        './sprk-google-analytics
    ),)