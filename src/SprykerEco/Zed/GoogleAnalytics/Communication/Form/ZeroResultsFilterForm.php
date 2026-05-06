<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Communication\Form;

use Symfony\Component\Form\Extension\Core\Type\IntegerType;
use Symfony\Component\Form\FormBuilderInterface;

/**
 * @method \SprykerEco\Zed\GoogleAnalytics\Business\GoogleAnalyticsFacadeInterface getFacade()
 * @method \SprykerEco\Zed\GoogleAnalytics\Communication\GoogleAnalyticsCommunicationFactory getFactory()
 * @method \SprykerEco\Zed\GoogleAnalytics\GoogleAnalyticsConfig getConfig()
 */
class ZeroResultsFilterForm extends AbstractGoogleAnalyticsFilterForm
{
    public const string FIELD_MINIMUM_COUNT = 'minimumCount';

    public function buildForm(FormBuilderInterface $builder, array $options): void
    {
        parent::buildForm($builder, $options);

        $builder->add(static::FIELD_MINIMUM_COUNT, IntegerType::class, [
            'required' => false,
            'data' => 0,
        ]);
    }
}
