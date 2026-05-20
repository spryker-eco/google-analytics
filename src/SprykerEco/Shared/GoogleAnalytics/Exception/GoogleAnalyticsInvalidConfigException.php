<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

namespace SprykerEco\Shared\GoogleAnalytics\Exception;

use Exception;

class GoogleAnalyticsInvalidConfigException extends Exception
{
    protected const string MESSAGE_TEMPLATE = 'Google Analytics setting "%s" is invalid or missing. Set it in the "Integrations > Google Analytics" configuration section.';

    public function __construct(string $configKey)
    {
        parent::__construct(sprintf(static::MESSAGE_TEMPLATE, $configKey));
    }
}
