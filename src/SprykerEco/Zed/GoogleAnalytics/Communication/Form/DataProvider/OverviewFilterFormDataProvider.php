<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Communication\Form\DataProvider;

use Spryker\Zed\Locale\Business\LocaleFacadeInterface;
use Spryker\Zed\Store\Business\StoreFacadeInterface;
use SprykerEco\Zed\GoogleAnalytics\GoogleAnalyticsConfig;

class OverviewFilterFormDataProvider
{
    protected const string PRESET_CHOICES_OPTION = 'preset_choices';

    protected const string DEFAULT_PRESET_OPTION = 'default_preset';

    protected const string STORE_CHOICES_OPTION = 'store_choices';

    protected const string LOCALE_CHOICES_OPTION = 'locale_choices';

    public function __construct(
        protected readonly GoogleAnalyticsConfig $config,
        protected readonly StoreFacadeInterface $storeFacade,
        protected readonly LocaleFacadeInterface $localeFacade,
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function getOptions(): array
    {
        return [
            static::PRESET_CHOICES_OPTION => array_flip($this->config->getDateRangePresets()),
            static::DEFAULT_PRESET_OPTION => $this->config->getDefaultDateRangePreset(),
            static::STORE_CHOICES_OPTION => $this->getStoreChoices(),
            static::LOCALE_CHOICES_OPTION => $this->getLocaleChoices(),
        ];
    }

    /**
     * @return array<string, string>
     */
    protected function getStoreChoices(): array
    {
        $choices = [];

        foreach ($this->storeFacade->getAllStores() as $storeTransfer) {
            $name = $storeTransfer->getNameOrFail();
            $choices[$name] = $name;
        }

        return $choices;
    }

    /**
     * @return array<string, string>
     */
    protected function getLocaleChoices(): array
    {
        $choices = [];

        foreach ($this->localeFacade->getLocaleCollection() as $localeTransfer) {
            $name = $localeTransfer->getLocaleNameOrFail();
            $choices[$name] = $name;
        }

        return $choices;
    }
}
